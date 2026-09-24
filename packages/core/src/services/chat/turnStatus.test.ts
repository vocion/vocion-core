/**
 * The rules that make the status vocabulary worth having (#114).
 *
 * Each value exists because it changes what the model is told or what the
 * person reads. These tests pin the two decisions that are easy to get wrong
 * later: which endings are kept out of history, and which ones are failures.
 */
import { describe, expect, it } from 'vitest';
import { isDroppedFromHistory, isFailure, isTurnStatus, preambleOnly, stoppedShort, TURN_STATUSES } from './turnStatus';

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

describe('a turn that did work and never answered', () => {
  it('is a failure the person is told about, and is not replayed as history', () => {
    expect(isFailure('stalled')).toBe(true);
    // Replaying "Reading" as if it were an answer teaches the model that was
    // an acceptable turn.
    expect(isDroppedFromHistory('stalled')).toBe(true);
    expect(isTurnStatus('stalled')).toBe(true);
  });

  it('catches tool work with no answer', () => {
    expect(stoppedShort({ text: 'Reading', toolCalls: 3 })).toBe(true);
    expect(stoppedShort({ text: 'I\'ll check what that page is.', toolCalls: 1 })).toBe(true);
  });

  it('does not catch a short answer to a short question', () => {
    // The check is a length against tool work, never a search for words like
    // "let me" — that would be wrong on "Yes, it merged." every time.
    expect(stoppedShort({ text: 'Yes — PR #16 merged on Sunday.', toolCalls: 0 })).toBe(false);
  });

  it('does not catch a turn that answered at length', () => {
    expect(stoppedShort({ text: 'a'.repeat(200), toolCalls: 5 })).toBe(false);
  });

  it('a turn made only of promises to look is stopped short, however long it is', () => {
    const twoPreambles = 'I\'ll pull what\'s on record before saying anything about it. Let me check whether anything is already in flight on this and where the upload path lives.';

    expect(twoPreambles.length).toBeGreaterThan(120);
    expect(preambleOnly(twoPreambles)).toBe(true);
    expect(stoppedShort({ text: twoPreambles, toolCalls: 2 })).toBe(true);
    // No tool call behind the promise is the emptiest stall of all (turn 577).
    expect(stoppedShort({ text: twoPreambles, toolCalls: 0 })).toBe(true);
    expect(stoppedShort({ text: 'Let me look', toolCalls: 0 })).toBe(true);
    expect(stoppedShort({ text: 'Yes.', toolCalls: 0 })).toBe(false);
  });

  it('a short real answer after a preamble is an answer', () => {
    const answered = 'Let me check what we actually know. No, Send does not support SSO today; nothing in the codebase, the wiki or the request history shows it built or planned.';

    expect(preambleOnly(answered)).toBe(false);
    expect(stoppedShort({ text: answered, toolCalls: 3 })).toBe(false);
    expect(preambleOnly('Yes — PR #16 merged on Sunday.')).toBe(false);
  });
});
