/**
 * The vocabulary of an agent's recommendation, and the rule for what a
 * recorded triage signal amounts to. Both are pure, and both are the kind of
 * thing that gets "tidied" into something subtly wrong later — a default of
 * `approve` for a missing value, or an edit counted as a rejection.
 */
import { describe, expect, it } from 'vitest';
import { decisionOutcome, parseSuggestedDecision, SUGGESTED_DECISIONS } from './suggestedDecision';

describe('parseSuggestedDecision', () => {
  it('accepts exactly the three recommendations an agent can give', () => {
    expect(SUGGESTED_DECISIONS).toEqual(['approve', 'reject', 'snooze']);

    for (const value of SUGGESTED_DECISIONS) {
      expect(parseSuggestedDecision(value)).toBe(value);
    }
  });

  it('reads a missing recommendation as none, never as approval', () => {
    // The whole metric depends on this: defaulting to `approve` would credit
    // every run proposed before the field existed with agreeing with whatever
    // the reviewer happened to do.
    expect(parseSuggestedDecision(undefined)).toBeUndefined();
    expect(parseSuggestedDecision(null)).toBeUndefined();
  });

  it('refuses values that are close but not one of the three', () => {
    // The column is jsonb, so anything can be in there — a past-tense spelling
    // from someone matching the human decision enum, a capitalised value from
    // a model, a whole object.
    expect(parseSuggestedDecision('approved')).toBeUndefined();
    expect(parseSuggestedDecision('rejected')).toBeUndefined();
    expect(parseSuggestedDecision('Approve')).toBeUndefined();
    expect(parseSuggestedDecision(' approve')).toBeUndefined();
    expect(parseSuggestedDecision({ suggestedDecision: 'approve' })).toBeUndefined();
    expect(parseSuggestedDecision(1)).toBeUndefined();
  });
});

describe('decisionOutcome', () => {
  it('counts an approval, and an approval the reviewer reworded, as approving', () => {
    // The reviewer reached the decision the agent recommended and changed the
    // wording on the way. Whether they took the payload as-is is what
    // `approvalRate` measures; counting a reworded approval as a disagreement
    // here would make the two metrics say the same thing twice.
    expect(decisionOutcome('approved')).toBe('approve');
    expect(decisionOutcome('edited')).toBe('approve');
    expect(decisionOutcome('rewritten')).toBe('approve');
  });

  it('counts a rejection as rejecting', () => {
    expect(decisionOutcome('rejected')).toBe('reject');
  });

  it('decides nothing for signals that leave the item pending', () => {
    // Skipping, saving and regenerating all leave the item in the queue.
    // Judging an agent on work nobody has finished judging is the same
    // mistake as folding snoozes into the approval rate.
    expect(decisionOutcome('skipped')).toBeNull();
    expect(decisionOutcome('saved')).toBeNull();
    expect(decisionOutcome('regenerated')).toBeNull();
  });

  it('decides nothing for a signal it has never heard of', () => {
    expect(decisionOutcome('escalated')).toBeNull();
    expect(decisionOutcome('')).toBeNull();
  });
});
