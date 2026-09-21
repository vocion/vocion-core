import { describe, expect, it } from 'vitest';
import { assertDecisionContract, DecisionContractError, isCompleteContract } from './decisionContract';

const full = {
  decision: 'Decide whether to ship the board with four requests unanswered.',
  recommendation: 'Hold the release until the four are answered.',
  why: ['Four askers are waiting.', 'The release notes would name work nobody confirmed.'],
  impactOfDelay: 'Four requests stay blocked.',
  actions: [{ id: 'hold', label: 'Hold the release', recommended: true }, { id: 'ship', label: 'Ship anyway' }],
};

describe('assertDecisionContract', () => {
  it('accepts a complete contract and keeps at most two reasons', () => {
    const out = assertDecisionContract({ ...full, why: [...full.why, 'A third reason nobody asked for.'] });

    expect(out.why).toHaveLength(2);
    expect(out.recommendationWhyNot).toBeNull();
    expect(out.actions.map(a => a.id)).toEqual(['hold', 'ship']);
  });

  it('refuses an ask with no decision, and says what to do instead', () => {
    expect(() => assertDecisionContract({ ...full, decision: '  ' })).toThrow(DecisionContractError);
    expect(() => assertDecisionContract({ ...full, decision: null })).toThrow(/investigate until you can present a decision/i);
  });

  it('refuses an ask with no choices — that is a notification, not a decision', () => {
    expect(() => assertDecisionContract({ ...full, actions: [] })).toThrow(/not a decision, it is a notification/i);
  });

  it('refuses a missing recommendation unless it says why none could be formed', () => {
    expect(() => assertDecisionContract({ ...full, recommendation: null })).toThrow(/say what you think should happen/i);

    const out = assertDecisionContract({ ...full, recommendation: null, recommendationWhyNot: 'Only the person who owns the budget knows.' });

    expect(out).toMatchObject({ recommendation: null, recommendationWhyNot: 'Only the person who owns the budget knows.' });
  });

  it('refuses silence about delay, and accepts "nothing" as the answer', () => {
    expect(() => assertDecisionContract({ ...full, impactOfDelay: '' })).toThrow(/say what happens if this waits/i);
    expect(assertDecisionContract({ ...full, impactOfDelay: 'Nothing — it is a reversible preference.' }).impactOfDelay).toMatch(/^Nothing/);
  });

  it('keeps at most one recommended choice and drops duplicates', () => {
    const out = assertDecisionContract({
      ...full,
      actions: [{ id: 'a', label: 'A', recommended: true }, { id: 'a', label: 'A again' }, { id: 'b', label: 'B', recommended: true }],
    });

    expect(out.actions.map(a => a.id)).toEqual(['a', 'b']);
    expect(out.actions.filter(a => a.recommended)).toHaveLength(1);
  });

  it('names the missing field on the error, so a caller can act on it', () => {
    expect.assertions(1);
    try {
      assertDecisionContract({ ...full, actions: null });
    } catch (error) {
      expect((error as DecisionContractError).missing).toBe('actions');
    }
  });
});

describe('isCompleteContract', () => {
  it('is false for an item filed before the contract existed', () => {
    expect(isCompleteContract(null)).toBe(false);
    expect(isCompleteContract({ decision: 'x', actions: [], impactOfDelay: 'y', recommendation: 'z', why: [], recommendationWhyNot: null })).toBe(false);
    expect(isCompleteContract(assertDecisionContract(full))).toBe(true);
  });
});
