/**
 * Reading the run list's outcome filter, and the bar "below threshold" means.
 *
 * The bar has to be the one the runner gates on: a page that calls a run
 * below threshold when the runner passed it, or the other way round, would
 * leave two answers to "is this eval failing".
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PASS_THRESHOLD, evaluatePassGate } from './passGate';
import { parseRunOutcome, passThresholdFor } from './runOutcome';

describe('parseRunOutcome', () => {
  it('reads the two filters and treats a missing one as every run', () => {
    expect(parseRunOutcome('errored')).toEqual({ ok: true, outcome: 'errored' });
    expect(parseRunOutcome('below_threshold')).toEqual({ ok: true, outcome: 'below_threshold' });
    expect(parseRunOutcome(null)).toEqual({ ok: true, outcome: undefined });
  });

  it('refuses a filter it does not know rather than showing every run under its name', () => {
    expect(parseRunOutcome('failed').ok).toBe(false);
  });
});

describe('passThresholdFor', () => {
  it('uses the same bar the runner gates on, with or without one set on the dataset', () => {
    expect(passThresholdFor(null)).toBe(evaluatePassGate(0.5, null).threshold);
    expect(passThresholdFor(null)).toBe(DEFAULT_PASS_THRESHOLD);
    expect(passThresholdFor(0.6)).toBe(evaluatePassGate(0.5, 0.6).threshold);
  });
});
