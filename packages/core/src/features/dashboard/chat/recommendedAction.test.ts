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
});
