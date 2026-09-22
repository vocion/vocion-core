/**
 * The autonomy ladder's arithmetic: which rung is next, whether the evidence
 * earns it under each tier's rule, and how a rung maps onto a trust rule.
 * Pure, no database.
 */
import { describe, expect, it } from 'vitest';
import { defaultRiskTier, evaluateEligibility, nextRung, previousRung, rungAutomates, rungFromTrustRule, TIER_RULES, trustRuleFor } from './rungs';

const evidence = (over: Partial<Parameters<typeof evaluateEligibility>[0]['evidence']> = {}) => ({
  n: 0,
  agreed: 0,
  agreementRate: null,
  rejections: 0,
  highConfidenceRejections: 0,
  autoExecutedRejections: 0,
  windowDays: 30,
  ...over,
});

describe('the ladder', () => {
  it('orders the six rungs and knows which ones automate', () => {
    expect(nextRung('execute-with-approval')).toBe('execute-within-bounds');
    expect(nextRung('autonomous')).toBeNull();
    expect(previousRung('observe')).toBeNull();
    expect(rungAutomates('execute-with-approval')).toBe(false);
    expect(rungAutomates('execute-within-bounds')).toBe(true);
    expect(rungAutomates('autonomous')).toBe(true);
  });

  it('maps rungs onto the trust rule ActionService reads, keeping the threshold on the way down', () => {
    expect(trustRuleFor('execute-within-bounds', 0.9)).toEqual({ enabled: true, threshold: 0.9 });
    expect(trustRuleFor('execute-with-approval', 0.9)).toEqual({ enabled: false, threshold: 0.9 });
    expect(rungFromTrustRule({ enabled: 'true' })).toBe('execute-within-bounds');
    expect(rungFromTrustRule({ enabled: 'false' })).toBe('execute-with-approval');
    expect(rungFromTrustRule(null)).toBe('execute-with-approval');
  });

  it('defaults risk by registry map, and assumes the worst about an unknown external kind', () => {
    expect(defaultRiskTier('hubspot.update')).toBe('low');
    expect(defaultRiskTier('gmail.send')).toBe('medium');
    expect(defaultRiskTier('personalization.enroll')).toBe('medium');
    expect(defaultRiskTier('linkedin.post', true)).toBe('high');
    // Reversible and internal, but a mission is a standing responsibility and a
    // playbook is procedure every run reads: held at approval until promoted.
    expect(defaultRiskTier('workspace.write_mission', false)).toBe('medium');
    expect(defaultRiskTier('workspace.write_playbook', false)).toBe('medium');
    expect(defaultRiskTier('internal.note', false)).toBe('low');
  });
});

describe('eligibility — low risk', () => {
  const rule = TIER_RULES.low;

  it('is earned at n>=20, >=90% agreement and no rejection in 14 days', () => {
    const r = evaluateEligibility({ rung: 'execute-with-approval', tier: 'low', evidence: evidence({ n: 20, agreed: 18, agreementRate: 0.9 }) });

    expect(r.earned).toBe(true);
    expect(r.nextRung).toBe('execute-within-bounds');
    expect(r.reason).toBe('Earned: promote to Execute within bounds.');
    expect(rule.minConfidence).toBe(0.85);
  });

  it('says how many more decisions it needs', () => {
    const r = evaluateEligibility({ rung: 'execute-with-approval', tier: 'low', evidence: evidence({ n: 8, agreed: 8, agreementRate: 1 }) });

    expect(r.earned).toBe(false);
    expect(r.reason).toBe('Needs 12 more decided recommendations (8 of 20).');
  });

  it('any rejection in the window blocks it', () => {
    const r = evaluateEligibility({ rung: 'execute-with-approval', tier: 'low', evidence: evidence({ n: 30, agreed: 29, agreementRate: 29 / 30, rejections: 1 }) });

    expect(r.earned).toBe(false);
    expect(r.gaps.map(g => g.kind)).toEqual(['rejections']);
  });

  it('can climb all the way to autonomous', () => {
    const r = evaluateEligibility({ rung: 'execute-within-bounds', tier: 'low', evidence: evidence({ n: 50, agreed: 49, agreementRate: 0.98 }) });

    expect(r).toMatchObject({ earned: true, nextRung: 'autonomous' });
  });
});

describe('eligibility — medium risk', () => {
  it('needs n>=40 and >=95%, and only a HIGH-confidence rejection blocks it', () => {
    const ok = evaluateEligibility({ rung: 'execute-with-approval', tier: 'medium', evidence: evidence({ n: 40, agreed: 38, agreementRate: 0.95, rejections: 2, highConfidenceRejections: 0 }) });
    const blocked = evaluateEligibility({ rung: 'execute-with-approval', tier: 'medium', evidence: evidence({ n: 40, agreed: 38, agreementRate: 0.95, rejections: 1, highConfidenceRejections: 1 }) });
    const thin = evaluateEligibility({ rung: 'execute-with-approval', tier: 'medium', evidence: evidence({ n: 40, agreed: 36, agreementRate: 0.9 }) });

    expect(ok.earned).toBe(true);
    expect(blocked.earned).toBe(false);
    expect(blocked.reason).toContain('high-confidence rejection');
    expect(thin.earned).toBe(false);
    expect(thin.reason).toBe('Needs 95% agreement — 90% agreement.');
    expect(TIER_RULES.medium.minConfidence).toBe(0.95);
  });

  it('stops at execute-within-bounds: autonomous takes a trust.yaml rule', () => {
    const r = evaluateEligibility({ rung: 'execute-within-bounds', tier: 'medium', evidence: evidence({ n: 400, agreed: 400, agreementRate: 1 }) });

    expect(r.earned).toBe(false);
    expect(r.gaps[0]!.kind).toBe('ceiling');
  });
});

describe('eligibility — high risk, never-auto, and below the default', () => {
  it('a high-risk kind never earns anything above execute-with-approval', () => {
    const r = evaluateEligibility({ rung: 'execute-with-approval', tier: 'high', evidence: evidence({ n: 1000, agreed: 1000, agreementRate: 1 }) });

    expect(r.earned).toBe(false);
    expect(r.reason).toContain('High-risk kinds stay at Execute with approval');
  });

  it('a never-auto kind is held whatever the evidence says, and the page says why', () => {
    const r = evaluateEligibility({ rung: 'execute-with-approval', tier: 'low', evidence: evidence({ n: 1000, agreed: 1000, agreementRate: 1 }), neverAuto: true });

    expect(r.earned).toBe(false);
    expect(r.gaps[0]!.kind).toBe('never-auto');
  });

  it('climbing back up to the default needs no evidence', () => {
    const r = evaluateEligibility({ rung: 'assist', tier: 'high', evidence: evidence() });

    expect(r).toMatchObject({ earned: true, nextRung: 'execute-with-approval' });
  });

  it('the top rung has nowhere to go', () => {
    expect(evaluateEligibility({ rung: 'autonomous', tier: 'low', evidence: evidence() })).toMatchObject({ earned: false, nextRung: null });
  });
});
