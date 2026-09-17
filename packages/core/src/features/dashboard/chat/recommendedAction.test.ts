import { describe, expect, it } from 'vitest';
import { readRecommendedAction } from './recommendedAction';

/**
 * On 2026-09-15 two `client.review.propose` calls 400'd with "Invalid input:
 * expected string, received undefined" — a card auto-firing at
 * `act-within-bounds` with no `actionId`. The server caught a call the client
 * should never have been able to make, so the check moved to the boundary the
 * payload arrives at.
 */
describe('readRecommendedAction', () => {
  it('accepts a complete recommendation and normalises what is missing', () => {
    const checked = readRecommendedAction({
      actionId: 'gmail.send',
      label: 'Send the follow-up',
      rationale: 'Owed since Tuesday',
      confidence: 0.82,
      agentSlug: 'revenue-lead',
    });

    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.rec).toMatchObject({
      actionId: 'gmail.send',
      label: 'Send the follow-up',
      // An action with no arguments is legitimate; a mangled one is not.
      input: {},
      confidence: 0.82,
    });
  });

  it.each([
    [{ input: { to: 'x' }, label: 'Send it' }, /named no action/],
    [{ actionId: '   ', label: 'Send it' }, /named no action/],
    [{ actionId: 'gmail.send' }, /no label/],
    [{ actionId: 'gmail.send', label: '  ' }, /no label/],
    [undefined, /was missing/],
    [null, /was missing/],
    ['gmail.send', /was missing/],
    [[{ actionId: 'gmail.send' }], /was missing/],
  ])('refuses %j with a reason a person could read', (raw, reason) => {
    const checked = readRecommendedAction(raw);

    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.reason).toMatch(reason);
  });

  it('drops a non-object input rather than passing it through to the RPC', () => {
    const checked = readRecommendedAction({ actionId: 'gmail.send', label: 'Send it', input: 'to: someone' });

    expect(checked.ok && checked.rec.input).toEqual({});
  });

  it('keeps a server-filed runId and ignores a malformed one', () => {
    expect(readRecommendedAction({ actionId: 'a', label: 'b', runId: 7 })).toMatchObject({ rec: { runId: 7 } });
    expect(readRecommendedAction({ actionId: 'a', label: 'b', runId: '7' })).not.toMatchObject({ rec: { runId: 7 } });
  });

  it('keeps the agent\'s own recommendation, so the queue card carries what the agent said', () => {
    const checked = readRecommendedAction({
      actionId: 'gmail.send',
      label: 'Draft the note',
      suggestedDecision: 'snooze',
      suggestedDecisionReason: '  Worth doing, but not before the contract is signed.  ',
    });

    expect(checked).toMatchObject({
      rec: { suggestedDecision: 'snooze', suggestedDecisionReason: 'Worth doing, but not before the contract is signed.' },
    });
  });

  it.each([
    [{ suggestedDecision: 'approve' }, 'a verdict with no sentence a reviewer could check'],
    [{ suggestedDecisionReason: 'It is time.' }, 'a sentence arguing for an outcome the card never names'],
    [{ suggestedDecision: 'maybe', suggestedDecisionReason: 'It is time.' }, 'a verdict that is not one of the three'],
  ])('drops %j — %s', (advice: Record<string, string>, _why: string) => {
    // Half a recommendation is worse than none: the card would show an
    // argument with no verdict, or a verdict a reviewer cannot weigh.
    const checked = readRecommendedAction({ actionId: 'gmail.send', label: 'Draft the note', ...advice });

    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.rec).not.toHaveProperty('suggestedDecision');
    expect(checked.ok && checked.rec).not.toHaveProperty('suggestedDecisionReason');
  });
});
