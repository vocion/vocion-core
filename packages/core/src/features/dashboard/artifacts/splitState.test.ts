import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampConversationSplit,
  clearStoredConversationSplit,
  CONVERSATION_MIN_WIDTH,
  CONVERSATION_TARGET_WIDTH,
  defaultConversationSplit,
  PANE_MIN_WIDTH,
  PANE_TARGET_WIDTH,
  readStoredConversationSplit,
  SPLIT_FALLBACK,
  writeStoredConversationSplit,
} from './splitState';

/**
 * The split is a ratio, but the rule is in pixels: assertions are written as
 * the widths the ratio produces, because that is what a person sees.
 * @param fraction - The conversation's share.
 * @param usable - The width the two panes share.
 */
const conversationAt = (fraction: number, usable: number) => Math.round(fraction * usable);
const paneAt = (fraction: number, usable: number) => Math.round((1 - fraction) * usable);

/** A 1920px window, sidebar open: measured in the browser after this change. */
const WIDE = 1560;
/** A 1440px laptop, sidebar open: measured the same way. */
const LAPTOP = 1080;
/** A 2560px monitor: past the point where both panes have all they want. */
const HUGE = 2200;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the default split', () => {
  it('renders a US-Letter sheet 1:1 on a 1920px monitor, where the cap used to shrink it', () => {
    const split = defaultConversationSplit(WIDE);

    expect(paneAt(split, WIDE)).toBe(PANE_TARGET_WIDTH);
    expect(conversationAt(split, WIDE)).toBe(676);
  });

  it('stops giving the conversation width once it has its measure', () => {
    const split = defaultConversationSplit(HUGE);

    expect(conversationAt(split, HUGE)).toBe(CONVERSATION_TARGET_WIDTH);
    // Everything past both targets lands on the document, which can use it.
    expect(paneAt(split, HUGE)).toBe(HUGE - CONVERSATION_TARGET_WIDTH);
  });

  it('never drops the conversation below the share this surface shipped with', () => {
    // A 1440px laptop cannot seat both targets. The document is served first
    // — it has a cliff and the transcript does not — but not past the point
    // where the transcript is narrower than it has always been.
    const split = defaultConversationSplit(LAPTOP);

    expect(split).toBeCloseTo(SPLIT_FALLBACK, 5);
    expect(conversationAt(split, LAPTOP)).toBe(450);
    expect(paneAt(split, LAPTOP)).toBe(630);
  });

  it('falls back to a ratio before anything has been measured', () => {
    expect(defaultConversationSplit(0)).toBe(SPLIT_FALLBACK);
    expect(defaultConversationSplit(Number.NaN)).toBe(SPLIT_FALLBACK);
    expect(defaultConversationSplit(-10)).toBe(SPLIT_FALLBACK);
  });
});

describe('clamping a stored or dragged split', () => {
  it('keeps the document pane above its minimum', () => {
    const split = clampConversationSplit(0.95, WIDE);

    expect(paneAt(split, WIDE)).toBe(PANE_MIN_WIDTH);
  });

  it('keeps the transcript above its minimum', () => {
    const split = clampConversationSplit(0.02, WIDE);

    expect(conversationAt(split, WIDE)).toBe(CONVERSATION_MIN_WIDTH);
  });

  it('leaves a sane value alone', () => {
    expect(clampConversationSplit(0.5, WIDE)).toBe(0.5);
  });

  it('splits a container too small for both minimums down the middle', () => {
    // 1024px with the sidebar open: neither pane can have what it wants, so
    // the answer is predictable rather than good.
    const tight = 741;

    expect(clampConversationSplit(0.9, tight)).toBeCloseTo(0.5, 5);
    expect(clampConversationSplit(0.1, tight)).toBeCloseTo(0.5, 5);
  });

  it('treats a corrupt number as nothing stored', () => {
    expect(clampConversationSplit(Number.NaN, WIDE)).toBeCloseTo(SPLIT_FALLBACK, 5);
    expect(clampConversationSplit(Number.POSITIVE_INFINITY, WIDE)).toBeCloseTo(SPLIT_FALLBACK, 5);
  });

  it('applies only the absolute guard rails before anything is measured', () => {
    expect(clampConversationSplit(0.5, 0)).toBe(0.5);
    expect(clampConversationSplit(0.99, 0)).toBe(0.8);
    expect(clampConversationSplit(0.01, 0)).toBe(0.2);
    expect(clampConversationSplit(Number.NaN, 0)).toBe(SPLIT_FALLBACK);
  });
});

describe('what this browser remembers', () => {
  /**
   * A localStorage stand-in whose contents the test controls.
   * @param initial - What storage already holds.
   */
  function stubStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    return store;
  }

  it('reads back what it wrote', () => {
    stubStorage();

    writeStoredConversationSplit(0.4489);

    expect(readStoredConversationSplit()).toBeCloseTo(0.449, 3);
  });

  it('reads nothing when nothing was stored', () => {
    stubStorage();

    expect(readStoredConversationSplit()).toBeNull();
  });

  it('reads nothing from an out-of-range or corrupt value', () => {
    for (const raw of ['1.5', '0', '1', '-0.4', 'half', '', '{"split":0.5}', 'NaN']) {
      stubStorage({ vocion_conversation_split: raw });

      expect(readStoredConversationSplit()).toBeNull();
    }
  });

  it('forgets on request, so the default rule applies again', () => {
    const store = stubStorage();
    writeStoredConversationSplit(0.7);

    clearStoredConversationSplit();

    expect(store.size).toBe(0);
    expect(readStoredConversationSplit()).toBeNull();
  });

  it('is silent when storage is unavailable — a private window is not an error', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });

    expect(readStoredConversationSplit()).toBeNull();
    expect(() => writeStoredConversationSplit(0.5)).not.toThrow();
    expect(() => clearStoredConversationSplit()).not.toThrow();
  });
});
