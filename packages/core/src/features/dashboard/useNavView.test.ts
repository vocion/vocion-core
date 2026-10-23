import { describe, expect, it, vi } from 'vitest';
import { NAV_VIEW_KEY, OPEN_MANAGE_VIEW, openManageView, readNavView, writeNavView } from './useNavView';

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
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(readNavView(throwing)).toBe('work');
    expect(() => writeNavView(throwing, 'manage')).not.toThrow();
  });
});

describe('openManageView', () => {
  it('persists the choice and announces it, so the header can open a sidebar mode', () => {
    // The manage view is a sidebar MODE, not a route: the header's avatar
    // menu has nothing to navigate to, so it asks by event. Node has neither
    // a window nor a localStorage, so both are stubbed here.
    const heard = vi.fn();
    const store = memoryStorage();
    vi.stubGlobal('localStorage', store);
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => heard(e.type) });
    try {
      openManageView();

      expect(heard).toHaveBeenCalledWith(OPEN_MANAGE_VIEW);
      expect(store.dump()).toEqual({ [NAV_VIEW_KEY]: 'manage' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does nothing server-side, where there is no window to announce to', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(() => openManageView()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
