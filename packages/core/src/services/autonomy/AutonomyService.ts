/**
 * AutonomyService — the autonomy ladder per action kind, and how a kind moves
 * on it.
 *
 * "Automation is earned" (docs/DESIGN-PRINCIPLES.md #8): a kind climbs from Execute
 * with approval to Execute within bounds when the alignment ledger says the
 * people deciding it would have let it run anyway — enough decisions, a high
 * enough agreement rate, no recent rejections — under the bar its risk tier
 * sets (`rungs.ts`, `TIER_RULES`). The promote button appears only when that
 * is true; demotion is always available, and happens on its own when a person
 * rejects something that had already auto-executed.
 *
 * `trust_rule` stays the execution record `ActionService` reads. Every rung
 * change here writes it: at or above Execute within bounds the rule is enabled
 * with `threshold = min_confidence`; below, it is disabled and keeps its
 * threshold. `trust.yaml` remains the source of truth for authored rules —
 * `syncPoliciesFromManifest` runs on every workspace apply — and in-app
 * promotions live in `autonomy_policy` rows, audited through the adoption
 * stream (`autonomy.promoted` / `autonomy.demoted`).
 */

import type { AlignmentEvidence, Eligibility, RiskTier, Rung } from './rungs';
import type { TrustManifest } from '@/libs/workspace/schemas';
import type { AlignmentScore } from '@/services/alignment/AlignmentService';
import { and, eq } from 'drizzle-orm';
import { isNeverAuto } from '@/libs/actions/neverAuto';
import { actionForPolicyKey } from '@/libs/actions/policyKey';
import { listActions } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { autonomyPolicySchema, trustRuleSchema } from '@/models/Schema';
import { evidenceFor, scoresByKey } from '@/services/alignment/AlignmentService';
import { DEFAULT_RUNG, defaultRiskTier, evaluateEligibility, isRiskTier, isRung, nextRung, previousRung, rungAutomates, rungFromTrustRule, rungIndex, TIER_RULES, trustRuleFor } from './rungs';

export class AutonomyError extends Error {
  constructor(
    public readonly code: 'NOT_EARNED' | 'AT_BOTTOM' | 'AT_TOP' | 'UNKNOWN_ACTION' | 'INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'AutonomyError';
  }
}

/** Where one action kind stands, with the evidence and the next step. */
export type AutonomyPolicyView = {
  actionId: string;
  /** The registry's display name; the id when nothing is registered. */
  name: string;
  registered: boolean;
  external: boolean;
  /** Held at Execute with approval by the platform, whatever the rule says. */
  neverAuto: boolean;
  rung: Rung;
  riskTier: RiskTier;
  minConfidence: number;
  /** Whether a proposal of this kind can run without a person today. */
  automates: boolean;
  promotedAt: Date | null;
  promotedBy: string | null;
  evidence: Record<string, unknown> | null;
  flagged: boolean;
  flagReason: string | null;
  source: string;
  /** 30-day alignment across every agent proposing this kind. */
  alignment: AlignmentScore;
  eligibility: Eligibility;
};

type PolicyRow = typeof autonomyPolicySchema.$inferSelect;
type TrustRow = typeof trustRuleSchema.$inferSelect;

/** The rung, tier and floor in force for one kind, with the rows behind them. */
export type EffectivePolicy = {
  actionId: string;
  rung: Rung;
  riskTier: RiskTier;
  minConfidence: number;
  policy: PolicyRow | null;
  trustRule: TrustRow | null;
};

function resolve(actionId: string, policy: PolicyRow | null, trustRule: TrustRow | null): EffectivePolicy {
  // The key may be derived (`objects.update_meta.request`); the action behind
  // it supplies the default tier, so a type nobody wrote a rule for is judged
  // as its action rather than as an unknown, high-risk kind.
  const action = actionForPolicyKey(actionId);
  const riskTier = policy && isRiskTier(policy.riskTier) ? policy.riskTier : defaultRiskTier(actionId, action?.external, action?.id);
  const rung = policy && isRung(policy.rung) ? policy.rung : rungFromTrustRule(trustRule);
  const minConfidence = policy?.minConfidence ?? trustRule?.threshold ?? TIER_RULES[riskTier].minConfidence;
  return { actionId, rung, riskTier, minConfidence, policy, trustRule };
}

/**
 * The rung, tier and confidence floor in force for one kind. A kind with no
 * policy row reads its rung off the trust rule (enabled = Execute within
 * bounds) and its tier off the registry defaults.
 * @param orgId
 * @param actionId
 */
export async function effectivePolicy(orgId: string, actionId: string): Promise<EffectivePolicy> {
  const [[policy], [trustRule]] = await Promise.all([
    db.select().from(autonomyPolicySchema).where(and(eq(autonomyPolicySchema.orgId, orgId), eq(autonomyPolicySchema.actionId, actionId))).limit(1),
    db.select().from(trustRuleSchema).where(and(eq(trustRuleSchema.orgId, orgId), eq(trustRuleSchema.actionId, actionId))).limit(1),
  ]);
  if (policy || trustRule) {
    return resolve(actionId, policy ?? null, trustRule ?? null);
  }
  // A DERIVED KEY WITH NO ROWS OF ITS OWN IS GOVERNED BY ITS ACTION'S ROWS.
  //
  // `git.merge` proposals are keyed `git.merge.<riskClass>` (policyKeyFor),
  // so a workspace that writes ONE rule — "a merge is a person's, whatever
  // the class" — used to write a rule nothing ever matched: every class fell
  // through to the registry default, and the rule in trust.yaml was a lie
  // about what governed the merge (2026-09-24, software-factory 2.0.0). The
  // class still wins when it has its own rule, which is how docs earns its
  // way while schema never does; this only fills the gap below it. The tier
  // already resolved this way (see `resolve`); the rung and threshold now do
  // too.
  const parent = actionForPolicyKey(actionId);
  if (!parent || parent.id === actionId || !parent.parentRuleGoverns) {
    // Opt-in per action: `objects.update_meta.<type>` keeps each type's
    // ledger its own, so a bare rule there binds to nothing.
    return resolve(actionId, null, null);
  }
  const [[parentPolicy], [parentRule]] = await Promise.all([
    db.select().from(autonomyPolicySchema).where(and(eq(autonomyPolicySchema.orgId, orgId), eq(autonomyPolicySchema.actionId, parent.id))).limit(1),
    db.select().from(trustRuleSchema).where(and(eq(trustRuleSchema.orgId, orgId), eq(trustRuleSchema.actionId, parent.id))).limit(1),
  ]);
  return resolve(actionId, parentPolicy ?? null, parentRule ?? null);
}

/**
 * The effective policy for every kind the org has a row or a rule for, in two
 * queries — for surfaces that need rung and tier per kind without the
 * evidence (the team report).
 * @param orgId
 */
export async function effectivePolicies(orgId: string): Promise<Map<string, EffectivePolicy>> {
  const [policies, trustRules] = await Promise.all([
    db.select().from(autonomyPolicySchema).where(eq(autonomyPolicySchema.orgId, orgId)),
    db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, orgId)),
  ]);
  const policyBy = new Map(policies.map(p => [p.actionId, p]));
  const trustBy = new Map(trustRules.map(t => [t.actionId, t]));
  const out = new Map<string, EffectivePolicy>();
  for (const actionId of new Set([...policyBy.keys(), ...trustBy.keys()])) {
    out.set(actionId, resolve(actionId, policyBy.get(actionId) ?? null, trustBy.get(actionId) ?? null));
  }
  return out;
}

/**
 * Whether the next rung is earned, with the evidence it was judged on.
 * @param orgId
 * @param actionId
 * @param now
 */
export async function eligibility(orgId: string, actionId: string, now: Date = new Date()): Promise<Eligibility & { evidence: AlignmentEvidence; effective: EffectivePolicy }> {
  const effective = await effectivePolicy(orgId, actionId);
  const evidence = await evidenceFor({ orgId, actionId, tier: effective.riskTier, minConfidence: effective.minConfidence, now });
  const action = actionForPolicyKey(actionId);
  const result = evaluateEligibility({ rung: effective.rung, tier: effective.riskTier, evidence, neverAuto: action ? isNeverAuto(action) : false });
  return { ...result, evidence, effective };
}

/**
 * Every action kind the org can see — registered actions, plus any kind a
 * policy row or a trust rule names — with rung, risk, alignment and
 * eligibility. One page's worth of data in a handful of queries.
 * @param orgId
 * @param now
 */
export async function listPolicies(orgId: string, now: Date = new Date()): Promise<AutonomyPolicyView[]> {
  const [policies, trustRules, alignment] = await Promise.all([
    db.select().from(autonomyPolicySchema).where(eq(autonomyPolicySchema.orgId, orgId)),
    db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, orgId)),
    scoresByKey(orgId, '30d', now),
  ]);
  const policyBy = new Map(policies.map(p => [p.actionId, p]));
  const trustBy = new Map(trustRules.map(t => [t.actionId, t]));
  const ids = new Set<string>([...listActions().map(a => a.id), ...policyBy.keys(), ...trustBy.keys()]);

  const views = await Promise.all([...ids].map(async (actionId) => {
    const action = actionForPolicyKey(actionId);
    const effective = resolve(actionId, policyBy.get(actionId) ?? null, trustBy.get(actionId) ?? null);
    const evidence = await evidenceFor({ orgId, actionId, tier: effective.riskTier, minConfidence: effective.minConfidence, now });
    const neverAuto = action ? isNeverAuto(action) : false;
    const p = effective.policy;
    return {
      actionId,
      name: action?.name ?? actionId,
      registered: !!action,
      external: action?.external ?? true,
      neverAuto,
      rung: effective.rung,
      riskTier: effective.riskTier,
      minConfidence: effective.minConfidence,
      automates: rungAutomates(effective.rung) && !neverAuto,
      promotedAt: p?.promotedAt ?? null,
      promotedBy: p?.promotedBy ?? null,
      evidence: p?.evidence ?? null,
      flagged: p?.flagged ?? false,
      flagReason: p?.flagReason ?? null,
      source: p?.source ?? (effective.trustRule ? 'trust.yaml' : 'default'),
      alignment: alignment.get(actionId) ?? { agreementRate: null, n: 0, agreed: 0, decided: 0, rejected: 0, withNote: 0, window: '30d' as const },
      eligibility: evaluateEligibility({ rung: effective.rung, tier: effective.riskTier, evidence, neverAuto }),
    } satisfies AutonomyPolicyView;
  }));

  // Flagged first (something needs a look), then what automates, then by id.
  return views.sort((a, b) => Number(b.flagged) - Number(a.flagged) || Number(b.automates) - Number(a.automates) || a.actionId.localeCompare(b.actionId));
}

/**
 * Write a rung for a kind: the policy row and the trust rule together, so
 * what the page says and what ActionService does can never disagree.
 * @param opts
 * @param opts.orgId
 * @param opts.actionId
 * @param opts.rung
 * @param opts.riskTier
 * @param opts.minConfidence
 * @param opts.by
 * @param opts.source
 * @param opts.evidence
 * @param opts.flagged
 * @param opts.flagReason
 */
async function writeRung(opts: {
  orgId: string;
  actionId: string;
  rung: Rung;
  riskTier: RiskTier;
  minConfidence: number;
  by: string | null;
  source: 'trust.yaml' | 'app' | 'system';
  evidence: Record<string, unknown> | null;
  flagged: boolean;
  flagReason: string | null;
}): Promise<void> {
  const now = new Date();
  const rule = trustRuleFor(opts.rung, opts.minConfidence);
  await db.transaction(async (tx) => {
    await tx
      .insert(autonomyPolicySchema)
      .values({
        orgId: opts.orgId,
        actionId: opts.actionId,
        rung: opts.rung,
        riskTier: opts.riskTier,
        minConfidence: opts.minConfidence,
        promotedAt: now,
        promotedBy: opts.by,
        evidence: opts.evidence,
        flagged: opts.flagged,
        flagReason: opts.flagReason,
        source: opts.source,
      })
      .onConflictDoUpdate({
        target: [autonomyPolicySchema.orgId, autonomyPolicySchema.actionId],
        set: {
          rung: opts.rung,
          riskTier: opts.riskTier,
          minConfidence: opts.minConfidence,
          promotedAt: now,
          promotedBy: opts.by,
          evidence: opts.evidence,
          flagged: opts.flagged,
          flagReason: opts.flagReason,
          source: opts.source,
          updatedAt: now,
        },
      });
    await tx
      .insert(trustRuleSchema)
      .values({ orgId: opts.orgId, actionId: opts.actionId, threshold: rule.threshold, enabled: String(rule.enabled) })
      .onConflictDoUpdate({
        target: [trustRuleSchema.orgId, trustRuleSchema.actionId],
        set: { threshold: rule.threshold, enabled: String(rule.enabled), updatedAt: now },
      });
  });
}

async function trackMove(orgId: string, by: string, type: 'autonomy.promoted' | 'autonomy.demoted', meta: { actionId: string; from: Rung; to: Rung; automatic: boolean }): Promise<void> {
  const { track } = await import('@/services/adoption/track');
  await track({ orgId, userId: by }, type, { meta });
}

/**
 * Step a kind up one rung — only when earned. The refusal is the product: the
 * button is not on the page unless this would succeed, and an API caller
 * gets told exactly what is missing.
 * @param orgId
 * @param actionId
 * @param by - The person promoting (user id).
 */
export async function promote(orgId: string, actionId: string, by: string): Promise<AutonomyPolicyView> {
  const e = await eligibility(orgId, actionId);
  if (!e.nextRung) {
    throw new AutonomyError('AT_TOP', `${actionId} is already at the top of the ladder`);
  }
  if (!e.earned) {
    throw new AutonomyError('NOT_EARNED', `Not earned yet: ${e.reason}`);
  }
  await writeRung({
    orgId,
    actionId,
    rung: e.nextRung,
    riskTier: e.effective.riskTier,
    minConfidence: e.effective.minConfidence,
    by,
    source: 'app',
    evidence: { ...e.evidence, promotedFrom: e.effective.rung, at: new Date().toISOString() },
    flagged: false,
    flagReason: null,
  });
  await trackMove(orgId, by, 'autonomy.promoted', { actionId, from: e.effective.rung, to: e.nextRung, automatic: false });
  return viewOf(orgId, actionId);
}

/**
 * Step a kind down one rung. Always available — taking automation away needs
 * no evidence. Clears any flag: a person has now looked.
 * @param orgId
 * @param actionId
 * @param by
 * @param reason
 */
export async function demote(orgId: string, actionId: string, by: string, reason?: string): Promise<AutonomyPolicyView> {
  const effective = await effectivePolicy(orgId, actionId);
  const to = previousRung(effective.rung);
  if (!to) {
    throw new AutonomyError('AT_BOTTOM', `${actionId} is already at Observe`);
  }
  await writeRung({
    orgId,
    actionId,
    rung: to,
    riskTier: effective.riskTier,
    minConfidence: effective.minConfidence,
    by,
    source: 'app',
    evidence: { demotedFrom: effective.rung, reason: reason ?? null, at: new Date().toISOString() },
    flagged: false,
    flagReason: null,
  });
  await trackMove(orgId, by, 'autonomy.demoted', { actionId, from: effective.rung, to, automatic: false });
  return viewOf(orgId, actionId);
}

/**
 * Clear the flag an automatic demotion left, without moving the rung.
 * @param orgId
 * @param actionId
 */
export async function acknowledgeFlag(orgId: string, actionId: string): Promise<AutonomyPolicyView> {
  await db
    .update(autonomyPolicySchema)
    .set({ flagged: false, flagReason: null })
    .where(and(eq(autonomyPolicySchema.orgId, orgId), eq(autonomyPolicySchema.actionId, actionId)));
  return viewOf(orgId, actionId);
}

/**
 * A person rejected a proposal of this kind. Two cases demote automatically:
 * the run had already auto-executed (the trust rule was wrong about it), or the
 * kind is high-risk and sits above the default. Either drops the kind one rung
 * and flags it. The floor for an automatic demotion is Execute with approval:
 * the system takes automation away, never the ability to propose — pushing a
 * kind further down is a person's call.
 *
 * Called from the alignment ledger on every action rejection; a no-op for
 * ordinary rejections of ordinary kinds, which are just evidence.
 * @param opts
 * @param opts.orgId
 * @param opts.actionId
 * @param opts.autoExecuted
 * @param opts.confidence
 */
export async function noteRejection(opts: { orgId: string; actionId: string; autoExecuted: boolean; confidence: number | null }): Promise<{ demoted: boolean; to?: Rung }> {
  const effective = await effectivePolicy(opts.orgId, opts.actionId);
  if (rungIndex(effective.rung) <= rungIndex(DEFAULT_RUNG)) {
    return { demoted: false };
  }
  const highRisk = effective.riskTier === 'high';
  if (!opts.autoExecuted && !highRisk) {
    return { demoted: false };
  }
  const to = previousRung(effective.rung) ?? DEFAULT_RUNG;
  const reason = opts.autoExecuted
    ? `A person rejected a ${opts.actionId} that had already executed under the trust rule${opts.confidence !== null ? ` at ${Math.round(opts.confidence * 100)}% confidence` : ''}.`
    : `A person rejected a high-risk ${opts.actionId} proposal.`;
  await writeRung({
    orgId: opts.orgId,
    actionId: opts.actionId,
    rung: to,
    riskTier: effective.riskTier,
    minConfidence: effective.minConfidence,
    by: 'system',
    source: 'system',
    evidence: { demotedFrom: effective.rung, reason, automatic: true, at: new Date().toISOString() },
    flagged: true,
    flagReason: reason,
  });
  await trackMove(opts.orgId, 'system', 'autonomy.demoted', { actionId: opts.actionId, from: effective.rung, to, automatic: true });
  return { demoted: true, to };
}

/**
 * A person undid a run the ladder released on its own — the strongest "no"
 * the ladder can hear. A promoted kind demotes the way a rejected auto-run
 * does; a kind running on the platform DEFAULT (reversible, low-risk, above
 * the bar — `libs/actions/autoAccept.ts`) is written down at Execute with
 * approval, flagged, so the default steps aside for it until a person
 * promotes it again. Without this row the very next proposal would run again.
 * @param opts
 * @param opts.orgId
 * @param opts.actionId
 * @param opts.confidence - The undone run's confidence, for the reason.
 * @param opts.by - Who undid it.
 */
export async function holdAfterUndo(opts: { orgId: string; actionId: string; confidence: number | null; by: string }): Promise<{ held: boolean; demoted: boolean }> {
  const effective = await effectivePolicy(opts.orgId, opts.actionId);
  if (rungIndex(effective.rung) > rungIndex(DEFAULT_RUNG)) {
    const { demoted } = await noteRejection({ orgId: opts.orgId, actionId: opts.actionId, autoExecuted: true, confidence: opts.confidence });
    return { held: false, demoted };
  }
  const reason = `A person undid a ${opts.actionId} that ran on its own${opts.confidence !== null ? ` at ${Math.round(opts.confidence * 100)}% confidence` : ''}. Held at Execute with approval until someone promotes it.`;
  await writeRung({
    orgId: opts.orgId,
    actionId: opts.actionId,
    rung: DEFAULT_RUNG,
    riskTier: effective.riskTier,
    minConfidence: effective.minConfidence,
    by: opts.by,
    source: 'system',
    evidence: { heldAfterUndo: true, reason, at: new Date().toISOString() },
    flagged: true,
    flagReason: reason,
  });
  return { held: true, demoted: false };
}

/**
 * Mirror `trust.yaml` into `autonomy_policy` on apply. The applier has already
 * replaced the org's `trust_rule` rows from the same file; this keeps the
 * policy rows for the kinds the file names in step (rung, risk, floor, source
 * `trust.yaml`) and leaves in-app promotions of unnamed kinds alone.
 *
 * Returns the problems worth failing the apply over: a rung that automates on
 * a rule that is disabled, or the reverse, would make the page and the gate
 * disagree about what runs.
 * @param orgId
 * @param manifest
 */
export async function syncPoliciesFromManifest(orgId: string, manifest: TrustManifest | null): Promise<Array<{ action: string; message: string }>> {
  const errors: Array<{ action: string; message: string }> = [];
  if (!manifest) {
    return errors;
  }
  const now = new Date();
  const riskMap = manifest.risk ?? {};
  const named = new Set<string>();
  for (const rule of manifest.rules) {
    named.add(rule.action);
    const rung = rule.rung ?? rungFromTrustRule({ enabled: rule.enabled });
    if (rungAutomates(rung) !== rule.enabled) {
      errors.push({ action: rule.action, message: `rung "${rung}" ${rungAutomates(rung) ? 'automates' : 'does not automate'} but enabled is ${rule.enabled} — they must agree` });
      continue;
    }
    const ruleAction = actionForPolicyKey(rule.action);
    const riskTier = rule.risk ?? riskMap[rule.action] ?? defaultRiskTier(rule.action, ruleAction?.external, ruleAction?.id);
    await db
      .insert(autonomyPolicySchema)
      .values({ orgId, actionId: rule.action, rung, riskTier, minConfidence: rule.autoApproveAbove, promotedAt: now, promotedBy: 'trust.yaml', source: 'trust.yaml', flagged: false, flagReason: null })
      .onConflictDoUpdate({
        target: [autonomyPolicySchema.orgId, autonomyPolicySchema.actionId],
        set: { rung, riskTier, minConfidence: rule.autoApproveAbove, promotedAt: now, promotedBy: 'trust.yaml', source: 'trust.yaml', flagged: false, flagReason: null, updatedAt: now },
      });
  }
  for (const [actionId, riskTier] of Object.entries(riskMap)) {
    if (named.has(actionId)) {
      continue;
    }
    // A tier for a kind with no rule: keep whatever rung it has (or the
    // default), set the tier, and let the tier's floor stand as the confidence.
    await db
      .insert(autonomyPolicySchema)
      .values({ orgId, actionId, rung: DEFAULT_RUNG, riskTier, minConfidence: null, source: 'trust.yaml' })
      .onConflictDoUpdate({
        target: [autonomyPolicySchema.orgId, autonomyPolicySchema.actionId],
        set: { riskTier, updatedAt: now },
      });
  }
  return errors;
}

async function viewOf(orgId: string, actionId: string): Promise<AutonomyPolicyView> {
  const views = await listPolicies(orgId);
  const view = views.find(v => v.actionId === actionId);
  if (!view) {
    throw new AutonomyError('UNKNOWN_ACTION', `No autonomy policy for ${actionId}`);
  }
  return view;
}

export { nextRung };
