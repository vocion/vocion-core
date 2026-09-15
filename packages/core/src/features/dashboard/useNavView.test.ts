import { describe, expect, it } from 'vitest';
import { NAV_VIEW_KEY, readNavView, writeNavView } from './useNavView';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
}

describe('sidebar nav view persistence', () => {
  it('defaults to work and only honours the exact "manage" value', () => {
    expect(readNavView(memoryStorage())).toBe('work');
    expect(readNavView(memoryStorage({ [NAV_VIEW_KEY]: 'manage' }))).toBe('manage');
    expect(readNavView(memoryStorage({ [NAV_VIEW_KEY]: 'MANAGE' }))).toBe('work');
    expect(readNavView(null)).toBe('work');
  });

  it('round-trips the chosen view', () => {
    const s = memoryStorage();
    writeNavView(s, 'manage');

    expect(s.dump()).toEqual({ [NAV_VIEW_KEY]: 'manage' });
    expect(readNavView(s)).toBe('manage');
  });

  it('swallows storage failures (private mode)', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

    expect(readNavView(throwing)).toBe('work');
    expect(() => writeNavView(throwing, 'manage')).not.toThrow();
  });
});
