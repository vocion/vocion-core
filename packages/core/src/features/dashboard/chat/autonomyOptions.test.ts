import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_MODES,
  autonomyHint,
  autonomyLabel,
  autonomyOptions,
  DEFAULT_AUTONOMY,
  isRaisedAutonomy,
} from './autonomyOptions';

/**
 * The autonomy rung moved out of the composer and into the rail header on
 * 2026-09-15. These cover the part that moved with it: which options exist,
 * in what order, and what a chip says for a given rung — the behaviour the
 * old segmented control carried implicitly in its markup.
 */

const COPY = {
  ask: 'Ask before acting',
  act: 'Act within bounds',
  askHint: 'Recommended actions are cards you tap into the review queue.',
  actHint: 'Recommended actions go straight to the review queue. Nothing executes without approval.',
};

describe('autonomyOptions', () => {
  it('offers both rungs, the default first', () => {
    expect(autonomyOptions(COPY).map(o => o.value)).toEqual(['act-within-bounds', 'ask']);
    expect(AUTONOMY_MODES).toEqual(['act-within-bounds', 'ask']);
  });

  it('carries the one-line consequence with each option', () => {
    const [act, ask] = autonomyOptions(COPY);

    expect(ask).toMatchObject({ label: COPY.ask, hint: COPY.askHint });
    expect(act).toMatchObject({ label: COPY.act, hint: COPY.actHint });
  });

  it('defaults to done-for-you — confident reversible actions run, with undo', () => {
    expect(DEFAULT_AUTONOMY).toBe('act-within-bounds');
  });
});

describe('autonomyLabel / autonomyHint', () => {
  it('names the rung a conversation is on', () => {
    expect(autonomyLabel('ask', COPY)).toBe(COPY.ask);
    expect(autonomyLabel('act-within-bounds', COPY)).toBe(COPY.act);
    expect(autonomyHint('act-within-bounds', COPY)).toBe(COPY.actHint);
  });

  it('reads an absent rung as the default, so the chip is never blank', () => {
    expect(autonomyLabel(undefined, COPY)).toBe(COPY.ask);
    expect(autonomyHint(undefined, COPY)).toBe(COPY.askHint);
  });
});

describe('isRaisedAutonomy', () => {
  it('is true only for the rung that proposes on its own', () => {
    expect(isRaisedAutonomy('act-within-bounds')).toBe(true);
    expect(isRaisedAutonomy('ask')).toBe(false);
    expect(isRaisedAutonomy(undefined)).toBe(false);
  });
});
