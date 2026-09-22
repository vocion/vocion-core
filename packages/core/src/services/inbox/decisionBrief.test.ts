import type { DecisionBriefInput } from '@/services/inbox/decisionBrief';
import { describe, expect, it } from 'vitest';
import { assertBrief, contractFromBrief, DecisionBriefError, isCompleteBrief, REQUIRED_BRIEF_FIELDS, strengthFor } from '@/services/inbox/decisionBrief';

const good: DecisionBriefInput = {
  decision: 'Build the two-pane admin panel for Send, or finish the Stamp rename first.',
  grounds: 'priority',
  whyNow: 'Send is at dogfood and the one asker is blocked every day it is not there.',
  evidence: [{ label: 'Request 38', href: '/dashboard/requests/38' }, { label: 'Stamp rename is 80% complete' }],
  scope: 'A read-only list and a detail pane, no writes.',
  cost: { size: 'medium', estimate: 'about three days for one engineer' },
  tradeoff: { displaces: ['the Stamp rename'], note: 'Starting admin pauses the rename, which is 80% done.' },
  doNothing: 'The asker keeps filing the same gap and the factory keeps re-asking.',
  recommendation: { choiceId: 'after-stamp', summary: 'Finish Stamp, then build admin.', strength: 'strong', reasons: ['The rename is nearly done', 'Nothing external depends on admin this week'] },
  consequence: { level: 'low', of: 'an internal surface nobody outside the company sees', reversible: true },
  choices: [
    { id: 'next', label: 'Build next' },
    { id: 'after-stamp', label: 'Build after Stamp' },
    { id: 'no', label: 'Do not build' },
  ],
};

const without = (field: keyof DecisionBriefInput): DecisionBriefInput => {
  const copy = { ...good };
  delete copy[field];
  return copy;
};

describe('decisionBrief', () => {
  it('accepts a complete brief and keeps every field', () => {
    const brief = assertBrief(good);

    expect(brief.decision).toBe(good.decision);
    expect(brief.tradeoff.displaces).toEqual(['the Stamp rename']);
    expect(brief.evidence).toHaveLength(2);
    expect(brief.choices.find(c => c.id === 'after-stamp')?.recommended).toBe(true);
  });

  describe('the required fields', () => {
    for (const field of REQUIRED_BRIEF_FIELDS) {
      it(`refuses a brief with no ${field}, and names it`, () => {
        expect(() => assertBrief(without(field))).toThrow(DecisionBriefError);

        try {
          assertBrief(without(field));
        } catch (e) {
          expect((e as DecisionBriefError).missing).toBe(field);
        }
      });
    }
  });

  describe('recommendation strength replaces confidence', () => {
    it('refuses a recommendation with no strength', () => {
      expect(() => assertBrief({ ...good, recommendation: { ...good.recommendation!, strength: undefined as never } })).toThrow(/strong or weak, never a percentage/);
    });

    it('refuses a recommendation with no reasons, strong or weak', () => {
      expect(() => assertBrief({ ...good, recommendation: { ...good.recommendation!, reasons: [] } })).toThrow(/no reasons is an opinion/);
    });

    it('refuses a recommendation pointing at a choice that is not offered', () => {
      expect(() => assertBrief({ ...good, recommendation: { ...good.recommendation!, choiceId: 'ship-it' } })).toThrow(/not one of the choices/);
    });

    it('turns a score into one of two words, and is deliberately strict', () => {
      expect(strengthFor(0.92)).toBe('strong');
      expect(strengthFor(0.8)).toBe('strong');
      expect(strengthFor(0.72)).toBe('weak');
      expect(strengthFor(null)).toBe('weak');
    });
  });

  describe('consequence replaces risk', () => {
    it('refuses a level with no subject, because "medium risk" invites "risk of what"', () => {
      expect(() => assertBrief({ ...good, consequence: { level: 'medium', of: '', reversible: true } })).toThrow(/of what\?/);
    });

    it('does not let size imply consequence: a large internal task stays low', () => {
      const brief = assertBrief({ ...good, cost: { size: 'large' }, consequence: { level: 'low', of: 'an internal surface', reversible: true } });

      expect(brief.cost.size).toBe('large');
      expect(brief.consequence.level).toBe('low');
    });

    it('keeps a small change high when it touches something that matters', () => {
      const brief = assertBrief({ ...good, cost: { size: 'small' }, consequence: { level: 'high', of: 'how existing customers authenticate', reversible: false } });

      expect(brief.consequence).toEqual({ level: 'high', of: 'how existing customers authenticate', reversible: false });
    });
  });

  describe('the tradeoff is never optional', () => {
    it('refuses a brief that does not say what it displaces', () => {
      expect(() => assertBrief({ ...good, tradeoff: { displaces: [], note: '' } })).toThrow(/displaces nothing, say that/);
    });

    it('accepts "nothing is displaced" when it is said out loud', () => {
      const brief = assertBrief({ ...good, tradeoff: { displaces: [], note: 'Nothing is displaced; there is capacity this week.' } });

      expect(brief.tradeoff.displaces).toEqual([]);
    });
  });

  it('refuses a single choice: one option is a notification', () => {
    expect(() => assertBrief({ ...good, choices: [{ id: 'next', label: 'Build next' }], recommendation: { ...good.recommendation!, choiceId: 'next' } })).toThrow(/one option is a notification/);
  });

  it('isCompleteBrief answers without throwing', () => {
    expect(isCompleteBrief(good as never)).toBe(true);
    expect(isCompleteBrief(without('doNothing') as never)).toBe(false);
    expect(isCompleteBrief(null)).toBe(false);
  });

  it('collapses to the contract the row already renders, with words instead of a percentage', () => {
    const contract = contractFromBrief(assertBrief(good));

    expect(contract.recommendation).toBe('Strongly recommend: Finish Stamp, then build admin.');
    expect(contract.impactOfDelay).toBe(good.doNothing);
    expect(contract.why).toHaveLength(2);
    expect(contract.actions).toHaveLength(3);
  });
});
