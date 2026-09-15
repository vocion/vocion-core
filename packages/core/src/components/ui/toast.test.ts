import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetToasts, __toasts, toast } from './toast';

describe('toast store', () => {
  beforeEach(() => {
    __resetToasts();
  });

  it('keeps at most three on screen, newest first', () => {
    toast.success('one');
    toast.success('two');
    toast.success('three');
    toast.success('four');

    expect(__toasts().map(t => t.title)).toEqual(['four', 'three', 'two']);
  });

  it('errors stay until dismissed; other tones expire on their own', () => {
    toast.error('broke');
    toast.success('fine');
    toast.pending('working');

    const byTitle = Object.fromEntries(__toasts().map(t => [t.title, t.duration]));
    expect(byTitle.broke).toBe(0);
    expect(byTitle.working).toBe(0);
    expect(byTitle.fine).toBe(5000);
  });

  it('an explicit duration wins over the tone default', () => {
    toast.error('broke', { duration: 2000 });
    expect(__toasts()[0]?.duration).toBe(2000);
  });

  it('dismiss removes exactly one', () => {
    const a = toast.info('a');
    toast.info('b');
    toast.dismiss(a);
    expect(__toasts().map(t => t.title)).toEqual(['b']);
  });

  it('carries a description and an action through to the record', () => {
    const onClick = vi.fn();
    toast.success('Approved', { description: 'Queued for review.', action: { label: 'Undo', onClick } });
    const [record] = __toasts();
    expect(record?.description).toBe('Queued for review.');
    record?.action?.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('promise resolves through one toast and re-throws rejections', async () => {
    const value = await toast.promise(Promise.resolve(7), {
      pending: 'saving',
      success: v => `saved ${v}`,
      error: 'failed',
    });
    expect(value).toBe(7);
    expect(__toasts()).toHaveLength(1);
    expect(__toasts()[0]).toMatchObject({ tone: 'success', title: 'saved 7' });

    const boom = new Error('nope');
    await expect(toast.promise(Promise.reject(boom), {
      pending: 'saving',
      success: 'saved',
      error: e => `failed: ${(e as Error).message}`,
    })).rejects.toThrow('nope');
    expect(__toasts()[0]).toMatchObject({ tone: 'error', title: 'failed: nope' });
  });

  it('update rewrites a toast in place rather than adding one', () => {
    const id = toast.pending('working');
    const same = toast.update(id, 'success', 'done');
    expect(same).toBe(id);
    expect(__toasts()).toHaveLength(1);
    expect(__toasts()[0]).toMatchObject({ tone: 'success', title: 'done' });
  });

  it('a promise toast does not swallow a synchronous throw', async () => {
    const fn = vi.fn(() => {
      throw new Error('sync');
    });
    await expect(toast.promise(Promise.resolve().then(fn), { pending: 'p', success: 's', error: 'e' })).rejects.toThrow('sync');
  });
});
