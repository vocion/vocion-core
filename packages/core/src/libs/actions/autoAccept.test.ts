import type { ExecutionFacts } from './autoAccept';
import { describe, expect, it } from 'vitest';
import { decideExecution, DEFAULT_AUTO_ACCEPT_CONFIDENCE } from './autoAccept';

const base: ExecutionFacts = {
  actionId: 'hubspot.update',
  confidence: 0.9,
  reversible: true,
  neverAuto: false,
  suggestedDecision: 'approve',
  rung: 'execute-with-approval',
  riskTier: 'low',
  minConfidence: 0.85,
  explicit: false,
};

describe('decideExecution — done for you by default', () => {
  it('runs a reversible, low-risk kind on its own above the bar, and says why on the run', () => {
    const d = decideExecution(base);

    expect(d.mode).toBe('execute');
    expect(d.source).toBe('default');
    expect(d.threshold).toBe(DEFAULT_AUTO_ACCEPT_CONFIDENCE);
    expect(d.reason).toMatch(/reversible, low-risk, 90% ≥ 80%/);
  });

  it('asks under the bar, naming the bar', () => {
    const d = decideExecution({ ...base, confidence: 0.6 });

    expect(d.mode).toBe('ask');
    expect(d.reason).toMatch(/60% is under the 80% bar/);
  });

  it('never runs what cannot be undone, whatever the confidence', () => {
    const d = decideExecution({ ...base, reversible: false, confidence: 0.99 });

    expect(d.mode).toBe('ask');
    expect(d.reason).toMatch(/cannot be undone/);
  });

  it('never runs a medium- or high-risk kind by default', () => {
    expect(decideExecution({ ...base, riskTier: 'medium' }).mode).toBe('ask');
    expect(decideExecution({ ...base, riskTier: 'high' }).reason).toMatch(/high-risk/);
  });

  it('the platform hold and the agent\'s own advice both win over confidence', () => {
    expect(decideExecution({ ...base, neverAuto: true, confidence: 1 })).toMatchObject({ mode: 'ask', source: 'never-auto' });
    expect(decideExecution({ ...base, suggestedDecision: 'reject', confidence: 1 })).toMatchObject({ mode: 'ask', source: 'advice' });
    expect(decideExecution({ ...base, suggestedDecision: 'snooze' })).toMatchObject({ mode: 'ask', source: 'advice' });
  });

  it('asks when no confidence was given — a missing number is not a high one', () => {
    expect(decideExecution({ ...base, confidence: undefined })).toMatchObject({ mode: 'ask', source: 'no-confidence' });
    expect(decideExecution({ ...base, confidence: Number.NaN }).mode).toBe('ask');
  });

  it('a thread set to ask before acting keeps its word', () => {
    expect(decideExecution({ ...base, conversationAutonomy: 'ask' })).toMatchObject({ mode: 'ask', source: 'conversation' });
    expect(decideExecution({ ...base, conversationAutonomy: 'act' }).mode).toBe('execute');
  });

  it('once a person or trust.yaml has spoken, the default stays out of it', () => {
    // A kind explicitly held at approval (a demotion after an undo, say).
    expect(decideExecution({ ...base, explicit: true })).toMatchObject({ mode: 'ask', source: 'held' });
    // Parked below the default: never runs.
    expect(decideExecution({ ...base, rung: 'recommend', confidence: 1 })).toMatchObject({ mode: 'ask', source: 'parked' });
  });

  it('an automating rung uses the trust rule\'s floor, not the default bar', () => {
    const within = { ...base, rung: 'execute-within-bounds' as const, explicit: true, minConfidence: 0.95 };

    expect(decideExecution({ ...within, confidence: 0.96 })).toMatchObject({ mode: 'execute', source: 'trust-rule', threshold: 0.95 });
    expect(decideExecution({ ...within, confidence: 0.9 })).toMatchObject({ mode: 'ask', source: 'trust-rule' });
    // The rule also runs irreversible kinds a person promoted — that is what promotion means.
    expect(decideExecution({ ...within, confidence: 0.96, reversible: false }).mode).toBe('execute');
  });
});
