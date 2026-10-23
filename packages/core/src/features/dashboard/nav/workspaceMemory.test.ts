import { describe, expect, it } from 'vitest';
import { MAX_REMEMBERED, NAV_WHERE_KEY, placeIn, readPlaces, rememberPlace } from './workspaceMemory';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('where the person was, per workspace', () => {
  it('keeps one place per workspace, so one workspace\'s app never bleeds into another', () => {
    const s = memoryStorage();
    rememberPlace(s, 'finance', { app: 'finance', path: '/dashboard/p/account-rules' }, 1);
    rememberPlace(s, 'revenue', { app: 'sales', path: '/gtm/proposals' }, 2);

    expect(placeIn(s, 'finance')).toEqual({ app: 'finance', path: '/dashboard/p/account-rules', at: 1 });
    expect(placeIn(s, 'revenue')?.app).toBe('sales');
    expect(placeIn(s, 'ops')).toBeNull();
    expect(placeIn(s, null)).toBeNull();
  });

  it('moves a workspace\'s place forward as the person moves', () => {
    const s = memoryStorage();
    rememberPlace(s, 'finance', { app: 'finance', path: '/dashboard/p/account-rules' }, 1);
    rememberPlace(s, 'finance', { app: 'home', path: '/dashboard/chat' }, 2);

    expect(placeIn(s, 'finance')).toEqual({ app: 'home', path: '/dashboard/chat', at: 2 });
  });

  it('forgets the oldest workspaces past the cap', () => {
    const s = memoryStorage();
    for (let i = 0; i <= MAX_REMEMBERED; i++) {
      rememberPlace(s, `w${i}`, { app: 'home', path: '/dashboard/chat' }, i);
    }

    expect(Object.keys(readPlaces(s))).toHaveLength(MAX_REMEMBERED);
    expect(placeIn(s, 'w0')).toBeNull();
    expect(placeIn(s, `w${MAX_REMEMBERED}`)).not.toBeNull();
  });

  it('reads anything it cannot read as nothing, and swallows storage failures', () => {
    expect(readPlaces(memoryStorage({ [NAV_WHERE_KEY]: 'not json' }))).toEqual({});
    expect(readPlaces(memoryStorage({ [NAV_WHERE_KEY]: JSON.stringify({ a: { app: 'x', path: 'no-slash', at: 1 }, b: { app: 'y', path: '/ok', at: 2 } }) }))).toEqual({ b: { app: 'y', path: '/ok', at: 2 } });

    const throwing = { getItem: () => {
      throw new Error('denied');
    }, setItem: () => {
      throw new Error('denied');
    } };

    expect(placeIn(throwing, 'finance')).toBeNull();
    expect(() => rememberPlace(throwing, 'finance', { app: 'finance', path: '/x' })).not.toThrow();
    expect(readPlaces(null)).toEqual({});
  });
});
