import { describe, expect, it } from 'vitest';
import { decideExecution } from './autoAccept';
import {
  ALWAYS_ASK_BAR,
  DEFAULT_LEARNING_EAGERNESS,
  eagernessReason,
  normaliseEagerness,
  selfImprovementBar,
} from './eagerness';

describe('selfImprovementBar', () => {
  it('puts the shipped default at 72% and the most eager setting at 60%', () => {
    expect(selfImprovementBar(DEFAULT_LEARNING_EAGERNESS)).toBe(0.72);
    expect(selfImprovementBar(10)).toBe(0.6);
  });

  it('always asks at 0 — no confidence can clear the bar', () => {
    expect(selfImprovementBar(0)).toBe(ALWAYS_ASK_BAR);
    expect(selfImprovementBar(0)).toBeGreaterThan(1);
  });

  it('is monotonic: more eager is never a higher bar', () => {
    const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(selfImprovementBar);

    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!).toBeLessThan(bars[i - 1]!);
    }
  });

  it('falls back to the default rather than throwing on a value nobody should have written', () => {
    for (const bad of [undefined, null, Number.NaN, -3, 11, 4.4e3]) {
      expect(selfImprovementBar(bad as number)).toBe(selfImprovementBar(DEFAULT_LEARNING_EAGERNESS));
    }

    expect(normaliseEagerness(9.6)).toBe(10);
  });

  it('says which dial decided, for the run', () => {
    expect(eagernessReason(7)).toBe('learning eagerness 7/10 → bar 72%');
    expect(eagernessReason(0)).toContain('always asks before it learns');
  });
});

describe('the dial inside decideExecution', () => {
  const facts = {
    actionId: 'learning.adopt_rule',
    reversible: true,
    neverAuto: false,
    suggestedDecision: 'approve' as const,
    rung: 'execute-with-approval' as const,
    riskTier: 'low' as const,
    minConfidence: 0.85,
    explicit: false,
    selfImproving: true,
  };

  it('adopts a plain directive at the default 7, and asks about an inferred one', () => {
    expect(decideExecution({ ...facts, confidence: 0.9, learningEagerness: 7 })).toMatchObject({ mode: 'execute', threshold: 0.72 });
    expect(decideExecution({ ...facts, confidence: 0.5, learningEagerness: 7 })).toMatchObject({ mode: 'ask', threshold: 0.72 });
  });

  it('still asks about an inferred rule at 10/10 — the dial moves the bar, not the judgement', () => {
    expect(decideExecution({ ...facts, confidence: 0.5, learningEagerness: 10 })).toMatchObject({ mode: 'ask', threshold: 0.6 });
    expect(decideExecution({ ...facts, confidence: 0.9, learningEagerness: 10 })).toMatchObject({ mode: 'execute', threshold: 0.6 });
  });

  it('never runs on its own at 0, however sure it is', () => {
    expect(decideExecution({ ...facts, confidence: 1, learningEagerness: 0 })).toMatchObject({ mode: 'ask' });
  });

  it('lets an explicit trust rule pin the kind regardless of how eager the workspace is', () => {
    // `explicit` is what ActionService sets when a trust.yaml rule or a
    // promoted policy names this kind; the trust-rule branch then decides and
    // the dial is never consulted.
    const pinned = { ...facts, explicit: true, rung: 'execute-within-bounds' as const, minConfidence: 0.95 };

    expect(decideExecution({ ...pinned, confidence: 0.9, learningEagerness: 10 })).toMatchObject({ mode: 'ask', threshold: 0.95, source: 'trust-rule' });
    expect(decideExecution({ ...pinned, confidence: 0.96, learningEagerness: 0 })).toMatchObject({ mode: 'execute', threshold: 0.95, source: 'trust-rule' });
  });

  it('leaves a kind that is not self-improving on the platform bar', () => {
    // The software-factory plugin's kinds, the wiki's, the connector writes:
    // none declares `selfImproving`, so the dial cannot loosen any of them.
    const other = { ...facts, actionId: 'git.push_branch', selfImproving: false };

    expect(decideExecution({ ...other, confidence: 0.75, learningEagerness: 10 })).toMatchObject({ mode: 'ask', threshold: 0.8 });
  });

  it('reads the platform default when the workspace authored no dial', () => {
    expect(decideExecution({ ...facts, confidence: 0.75, learningEagerness: null })).toMatchObject({ mode: 'execute', threshold: 0.72 });
  });
});
