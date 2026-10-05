import { describe, expect, it } from 'vitest';
import { inOrder, keycapLabel } from './liveBrowser';

describe('browser calls in one session run one at a time, in the order asked', () => {
  it('holds each call until the one before it — its action and its spoken hold — has finished (FE-449: four presses in 7 ms)', async () => {
    const log: string[] = [];
    const call = (name: string, holdMs: number) => inOrder('run-449', async () => {
      log.push(`${name} start`);
      await new Promise(r => setTimeout(r, holdMs));
      log.push(`${name} end`);
      return name;
    });

    // Sent at once, as a model sends parallel tool calls.
    const done = await Promise.all([call('press ?', 30), call('press Escape', 5), call('press ArrowDown', 15)]);

    expect(done).toEqual(['press ?', 'press Escape', 'press ArrowDown']);
    expect(log).toEqual(['press ? start', 'press ? end', 'press Escape start', 'press Escape end', 'press ArrowDown start', 'press ArrowDown end']);
  });

  it('lets the next call run when one fails, and keeps two sessions independent', async () => {
    const failed = inOrder('run-a', async () => {
      throw new Error('ref gone');
    });
    const after = inOrder('run-a', async () => 'pressed');
    const other = inOrder('run-b', async () => 'other session');

    await expect(failed).rejects.toThrow('ref gone');
    await expect(after).resolves.toBe('pressed');
    await expect(other).resolves.toBe('other session');
  });
});

describe('the keycap a demo shows for a press', () => {
  it('reads the way a person names the key', () => {
    expect(keycapLabel('ArrowDown')).toBe('↓');
    expect(keycapLabel('Escape')).toBe('Esc');
    expect(keycapLabel('Enter')).toBe('Enter ↵');
    expect(keycapLabel('s')).toBe('S');
    expect(keycapLabel('?')).toBe('?');
    expect(keycapLabel('Meta+K')).toBe('⌘ K');
    expect(keycapLabel('Shift+?')).toBe('⇧ ?');
  });
});
