/**
 * The rules that make the status vocabulary worth having (#114).
 *
 * Each value exists because it changes what the model is told or what the
 * person reads. These tests pin the two decisions that are easy to get wrong
 * later: which endings are kept out of history, and which ones are failures.
 */
import { describe, expect, it } from 'vitest';
import { isDroppedFromHistory, isFailure, isTurnStatus, TURN_STATUSES } from './turnStatus';

describe('isDroppedFromHistory', () => {
  it('drops the endings whose text would teach the model something false', () => {
    expect(isDroppedFromHistory('incomplete')).toBe(true);
    expect(isDroppedFromHistory('failed')).toBe(true);
    expect(isDroppedFromHistory('refused')).toBe(true);
  });

  it('keeps a turn the person stopped, because they read it and decided that was enough', () => {
    expect(isDroppedFromHistory('stopped')).toBe(false);
  });

  it('keeps both halves of an answer a surface split in two', () => {
    expect(isDroppedFromHistory('truncated')).toBe(false);
    expect(isDroppedFromHistory('continued')).toBe(false);
  });

  it('keeps a finished turn, and a legacy row that predates the vocabulary', () => {
    expect(isDroppedFromHistory('complete')).toBe(false);
    expect(isDroppedFromHistory(null)).toBe(false);
    expect(isDroppedFromHistory(undefined)).toBe(false);
  });

  it('keeps a value nobody here recognises, so a stray string never silently erases a turn from history', () => {
    expect(isDroppedFromHistory('whatever')).toBe(false);
  });
});

describe('isFailure', () => {
  it('is true only for the endings that owe the person an explanation', () => {
    expect(isFailure('incomplete')).toBe(true);
    expect(isFailure('failed')).toBe(true);
    expect(isFailure('refused')).toBe(true);
  });

  it('is false for the ordinary endings, which carry a marker at most', () => {
    expect(isFailure('complete')).toBe(false);
    expect(isFailure('stopped')).toBe(false);
    expect(isFailure('truncated')).toBe(false);
    expect(isFailure('continued')).toBe(false);
    expect(isFailure(null)).toBe(false);
  });
});

describe('isTurnStatus', () => {
  it('knows every ending this product writes', () => {
    for (const status of TURN_STATUSES) {
      expect(isTurnStatus(status)).toBe(true);
    }
  });

  it('rejects anything else, so a typo is caught where it is written rather than read as a healthy turn', () => {
    expect(isTurnStatus('stoped')).toBe(false);
    expect(isTurnStatus('')).toBe(false);
    expect(isTurnStatus(null)).toBe(false);
    expect(isTurnStatus(7)).toBe(false);
  });

  it('covers every value the failure and history rules can be asked about', () => {
    // Both rules take a status and answer; neither may throw or silently agree
    // with a value the list does not carry.
    for (const status of TURN_STATUSES) {
      expect(typeof isFailure(status)).toBe('boolean');
      expect(typeof isDroppedFromHistory(status)).toBe('boolean');
    }
    // Every failure is kept out of history, and nothing else is.
    const failures = TURN_STATUSES.filter(s => isFailure(s));
    const dropped = TURN_STATUSES.filter(s => isDroppedFromHistory(s));

    expect(dropped).toEqual(failures);
  });
});
