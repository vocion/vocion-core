import { describe, expect, it } from 'vitest';
import { MIN_PENDING_MS, withMinimumPending } from './pending';

/**
 * A fast server never flashes; a slow one is never made slower.
 */
describe('withMinimumPending', () => {
  it('holds a fast result until the floor has passed', async () => {
    const order: string[] = [];
    let release!: () => void;
    const wait = () => new Promise<void>((r) => {
      release = () => {
        order.push('floor');
        r();
      };
    });
    const p = withMinimumPending(Promise.resolve('ok').then((v) => {
      order.push('work');
      return v;
    }), 400, wait);
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['work']);

    release();

    expect(await p).toBe('ok');
    expect(order).toEqual(['work', 'floor']);
  });

  it('waits for the real response when it is longer than the floor', async () => {
    let done!: (v: string) => void;
    const work = new Promise<string>((r) => {
      done = r;
    });
    let settled = false;
    const p = withMinimumPending(work, 0, () => Promise.resolve()).then((v) => {
      settled = true;
      return v;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);

    done('late');

    expect(await p).toBe('late');
  });

  it('still surfaces a failure, after the floor', async () => {
    await expect(withMinimumPending(Promise.reject(new Error('nope')), 0, () => Promise.resolve())).rejects.toThrow('nope');
  });

  it('defaults to about 400ms', () => {
    expect(MIN_PENDING_MS).toBe(400);
  });
});
