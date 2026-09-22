/**
 * The autonomy ladder — the manifesto's "Automation is earned" as data.
 *
 *   Observe → Recommend → Assist → Execute with approval → Execute within bounds → Operate autonomously
 *
 * Pure: no database, no imports from services. Everything that decides where
 * an action kind stands, what the next rung would take, and how a rung maps to
 * the `trust_rule` ActionService reads lives here so the service, the router,
 * the applier and the tests all agree on one vocabulary.
 */

import { SELF_UPDATE_RISK } from '@/libs/actions/selfUpdate';

export const RUNGS = [
  'observe',
  'recommend',
  'assist',
  'execute-with-approval',
  'execute-within-bounds',
  'autonomous',
] as const;

export type Rung = typeof RUNGS[number];

export const RUNG_LABEL: Record<Rung, string> = {
  'observe': 'Observe',
  'recommend': 'Recommend',
  'assist': 'Assist',
  'execute-with-approval': 'Execute with approval',
  'execute-within-bounds': 'Execute within bounds',
  'autonomous': 'Operate autonomously',
};

/** Short form for a dense cell: "w/ approval", "in bounds". */
export const RUNG_SHORT: Record<Rung, string> = {
  'observe': 'Observe',
  'recommend': 'Recommend',
  'assist': 'Assist',
  'execute-with-approval': 'Approval',
  'execute-within-bounds': 'In bounds',
  'autonomous': 'Autonomous',
};

/** Where every action kind starts: proposed, then a person decides. */
export const DEFAULT_RUNG: Rung = 'execute-with-approval';

/** The first rung at which a proposal can execute without a person. */
export const FIRST_AUTOMATED_RUNG: Rung = 'execute-within-bounds';

export function rungIndex(rung: Rung): number {
  return RUNGS.indexOf(rung);
}

export function isRung(value: unknown): value is Rung {
  return typeof value === 'string' && (RUNGS as readonly string[]).includes(value);
}

export function nextRung(rung: Rung): Rung | null {
  return RUNGS[rungIndex(rung) + 1] ?? null;
}

export function previousRung(rung: Rung): Rung | null {
  const i = rungIndex(rung);
  return i > 0 ? RUNGS[i - 1]! : null;
}

/**
 * Whether proposals of this kind may run without a person at this rung.
 * @param rung
 */
export function rungAutomates(rung: Rung): boolean {
  return rungIndex(rung) >= rungIndex(FIRST_AUTOMATED_RUNG);
}

/* ------------------------------------------------------------------ */
/* Risk tiers                                                          */
/* ------------------------------------------------------------------ */

export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = typeof RISK_TIERS[number];

export function isRiskTier(value: unknown): value is RiskTier {
  return typeof value === 'string' && (RISK_TIERS as readonly string[]).includes(value);
}

/**
 * The platform's view of how much a mistake costs, per registered action id.
 * A workspace overrides any of these in `trust.yaml` (`risk:` per rule, or the
 * top-level `risk:` map). Anything external and unlisted is `high`: the ladder
 * assumes the worst about an action it has not been told about.
 */
export const DEFAULT_RISK_TIER: Record<string, RiskTier> = {
  // The self-improvement class declares its own tiers, so the ladder, the
  // autonomy page and the class read one table (`libs/actions/selfUpdate.ts`).
  ...SELF_UPDATE_RISK,
  'hubspot.update': 'low',
  'gmail.send': 'medium',
  'personalization.enroll': 'medium',
  'discovery.review_proposal': 'low',
  'objects.propose_candidate': 'medium',
  // Internal writes an agent makes on the workspace's own records and queue.
  // Each is reversible and costs a person at most a minute to put back, so
  // the done-for-you default applies. A workspace holding a type's writes to
  // approval says so in trust.yaml.
  'objects.update_meta': 'low',
  'ask.file': 'low',
  'ask.withdraw': 'low',
  'qc.hold': 'low',
  'qc.release': 'medium',
  'qc.request_rework': 'low',
  'dataset.add_example': 'low',
  // Reversible and internal, so the done-for-you default would run them above
  // 0.8 — but a mission is a standing responsibility and a playbook is the
  // procedure every run reads. Medium holds both at Execute with approval
  // until a workspace's trust.yaml promotes them.
  'workspace.write_mission': 'medium',
  'workspace.write_playbook': 'medium',
  // The operating intent is the standing instruction every choosing agent
  // reads, so a confident agent does not get to restate a person's own
  // priorities for them. Medium, beside the other two.
  'workspace.write_operating_intent': 'medium',
};

/**
 * The default tier for an action id, given whether the registry marks it as
 * touching the outside world.
 * @param actionId - The ladder key: an action id, or a key derived from one.
 * @param external - `Action.external`; unknown ids are treated as external.
 * @param baseActionId - The registered id behind a derived key, whose own
 * default stands in when the key has none (`objects.update_meta.request` →
 * `objects.update_meta`).
 */
export function defaultRiskTier(actionId: string, external: boolean | undefined = true, baseActionId?: string): RiskTier {
  return DEFAULT_RISK_TIER[actionId] ?? (baseActionId ? DEFAULT_RISK_TIER[baseActionId] : undefined) ?? (external ? 'high' : 'low');
}

/* ------------------------------------------------------------------ */
/* Eligibility — is the next rung earned?                              */
/* ------------------------------------------------------------------ */

/** What the ledger says about one action kind, in the shape eligibility reads. */
export type AlignmentEvidence = {
  /** Decisions in the evidence window where something was recommended. */
  n: number;
  /** Of those, how many agreed with the recommendation. */
  agreed: number;
  /** agreed ÷ n, or null when n is 0. */
  agreementRate: number | null;
  /** Rejections in the tier's rejection window (14d for low, 30d for medium). */
  rejections: number;
  /** Rejections of proposals at or above the confidence floor, same window. */
  highConfidenceRejections: number;
  /** Rejections of runs that had already auto-executed, same window. */
  autoExecutedRejections: number;
  /** Days the evidence window covers. */
  windowDays: number;
};

export type TierRule = {
  /** Minimum decided-with-recommendation count. */
  minN: number;
  /** Minimum agreement rate, 0-1. */
  minAgreement: number;
  /** Days over which rejections are counted. */
  rejectionWindowDays: number;
  /** Which rejections block: any, or only high-confidence ones. */
  rejectionsCounted: 'any' | 'high-confidence';
  /** Confidence floor a promotion writes into the trust rule. */
  minConfidence: number;
  /** The highest rung evidence alone can earn; beyond it takes an explicit trust.yaml rule. */
  ceiling: Rung;
};

/**
 * The defaults, by tier. Written down once so the page, the docs and the
 * tests quote the same numbers:
 *
 * | tier   | n   | agreement | rejections                    | floor | ceiling                |
 * |--------|-----|-----------|-------------------------------|-------|------------------------|
 * | low    | 20  | 90%       | none in 14d                   | 0.85  | autonomous             |
 * | medium | 40  | 95%       | no high-confidence one in 30d | 0.95  | execute-within-bounds  |
 * | high   | —   | —         | never above approval          | 0.99  | execute-with-approval  |
 */
export const TIER_RULES: Record<RiskTier, TierRule> = {
  low: { minN: 20, minAgreement: 0.9, rejectionWindowDays: 14, rejectionsCounted: 'any', minConfidence: 0.85, ceiling: 'autonomous' },
  medium: { minN: 40, minAgreement: 0.95, rejectionWindowDays: 30, rejectionsCounted: 'high-confidence', minConfidence: 0.95, ceiling: 'execute-within-bounds' },
  high: { minN: Number.POSITIVE_INFINITY, minAgreement: 1, rejectionWindowDays: 30, rejectionsCounted: 'any', minConfidence: 0.99, ceiling: 'execute-with-approval' },
};

export type Eligibility = {
  /** The rung a promotion would move to, or null at the top of what evidence can earn. */
  nextRung: Rung | null;
  /** True when the evidence clears every bar for `nextRung`. */
  earned: boolean;
  /** One plain sentence for the page: "Earned: promote to …" or what is still missing. */
  reason: string;
  /** Machine-readable gaps, empty when earned. */
  gaps: Array<{ kind: 'n' | 'agreement' | 'rejections' | 'ceiling' | 'never-auto' | 'rung-below-approval'; message: string }>;
};

/**
 * Whether the next rung is earned from the evidence, under the tier's rule.
 *
 * Rungs below Execute with approval need no evidence to climb back — they are
 * where a person parked the kind, not where it fell — so the only bar there is
 * that someone asks. Above it, every step must be earned. The ceiling and the
 * never-auto list are hard stops: the page says so instead of counting to a
 * number that would never release anything.
 * @param input
 * @param input.rung - Where the kind stands now.
 * @param input.tier - Its risk tier.
 * @param input.evidence - The ledger's numbers.
 * @param input.neverAuto - Whether the platform holds this kind at approval.
 */
export function evaluateEligibility(input: { rung: Rung; tier: RiskTier; evidence: AlignmentEvidence; neverAuto?: boolean }): Eligibility {
  const rule = TIER_RULES[input.tier];
  const next = nextRung(input.rung);
  const label = (r: Rung) => RUNG_LABEL[r];
  if (!next) {
    return { nextRung: null, earned: false, reason: 'At the top of the ladder.', gaps: [{ kind: 'ceiling', message: 'Already operating autonomously.' }] };
  }
  // Climbing back up to the default rung is a person's call, not evidence's.
  if (rungIndex(next) <= rungIndex(DEFAULT_RUNG)) {
    return { nextRung: next, earned: true, reason: `Below the default — restore to ${label(next)} when you are ready.`, gaps: [] };
  }
  if (input.neverAuto) {
    return {
      nextRung: next,
      earned: false,
      reason: 'Held at Execute with approval by the platform: this kind reaches a real person or publishes outside, and no rule can release it.',
      gaps: [{ kind: 'never-auto', message: 'Never auto-executed, by design.' }],
    };
  }
  if (rungIndex(next) > rungIndex(rule.ceiling)) {
    return {
      nextRung: next,
      earned: false,
      reason: input.tier === 'high'
        ? 'High-risk kinds stay at Execute with approval unless trust.yaml says otherwise.'
        : `${input.tier === 'medium' ? 'Medium' : 'Low'}-risk kinds earn up to ${label(rule.ceiling)}; beyond that takes an explicit trust.yaml rule.`,
      gaps: [{ kind: 'ceiling', message: `Evidence alone stops at ${label(rule.ceiling)}.` }],
    };
  }
  const gaps: Eligibility['gaps'] = [];
  const e = input.evidence;
  if (e.n < rule.minN) {
    const missing = rule.minN - e.n;
    gaps.push({ kind: 'n', message: `Needs ${missing} more decided ${missing === 1 ? 'recommendation' : 'recommendations'} (${e.n} of ${rule.minN}).` });
  }
  if (e.agreementRate === null || e.agreementRate < rule.minAgreement) {
    const have = e.agreementRate === null ? 'no agreement yet' : `${Math.round(e.agreementRate * 100)}% agreement`;
    gaps.push({ kind: 'agreement', message: `Needs ${Math.round(rule.minAgreement * 100)}% agreement — ${have}.` });
  }
  const blocking = rule.rejectionsCounted === 'any' ? e.rejections : e.highConfidenceRejections;
  if (blocking > 0) {
    const what = rule.rejectionsCounted === 'any' ? 'rejection' : 'high-confidence rejection';
    gaps.push({ kind: 'rejections', message: `${blocking} ${what}${blocking === 1 ? '' : 's'} in the last ${rule.rejectionWindowDays} days — needs none.` });
  }
  if (gaps.length === 0) {
    return { nextRung: next, earned: true, reason: `Earned: promote to ${label(next)}.`, gaps };
  }
  // Lead with the count gap when there is one: it is the one a person can
  // do something about today, by deciding more items.
  return { nextRung: next, earned: false, reason: gaps[0]!.message, gaps };
}

/* ------------------------------------------------------------------ */
/* Mapping to trust_rule                                               */
/* ------------------------------------------------------------------ */

/**
 * What the `trust_rule` row for an action must say for it to sit at `rung`.
 * Below the first automated rung the rule is disabled and keeps its threshold,
 * so a demotion is reversible by re-promoting without retyping the number.
 * @param rung
 * @param minConfidence - The policy's confidence floor, or the tier default.
 */
export function trustRuleFor(rung: Rung, minConfidence: number): { enabled: boolean; threshold: number } {
  return { enabled: rungAutomates(rung), threshold: minConfidence };
}

/**
 * The rung a bare `trust_rule` implies when no policy row exists yet: an
 * enabled rule is Execute within bounds; anything else is the default.
 * @param rule
 */
export function rungFromTrustRule(rule: { enabled: string | boolean } | null | undefined): Rung {
  const enabled = rule?.enabled === true || rule?.enabled === 'true';
  return enabled ? 'execute-within-bounds' : DEFAULT_RUNG;
}
