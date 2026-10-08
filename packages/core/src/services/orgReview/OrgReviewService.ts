/**
 * The weekly org review — the team looking at itself.
 *
 * Once a week (per workspace, `defaults.orgReview`), the review reads the
 * evidence core already stores (`signals.ts`), derives typed findings from it
 * in code (`findings.ts`), has a small model judge which of them warrant a
 * change and which (`judge.ts`), and files each change as an `org.change`
 * proposal on Needs you — through the same proposal and trust path as every
 * other action, so at its rung it waits for a person. Approving applies the
 * change, with Undo. Nothing about the team changes silently.
 *
 * It also tidies the rulebook: when this workspace's learning compaction is
 * due, it runs it (`ConsolidationService.runConsolidation`), so a deployment
 * without the feedback worker still merges near-duplicate rules and proposes
 * retiring stale ones on the learnings surface.
 *
 * Bounded by design: at most `maxProposals` cards per review, strongest
 * finding first. A review that files thirty cards is the queue nobody reads.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { JudgedProposal, JudgeOutcome } from './judge';
import type { OrgChangeInput } from '@/libs/actions/org-change';
import { and, eq, gte } from 'drizzle-orm';
import { orgChangeTarget } from '@/libs/actions/org-change';
import { db } from '@/libs/DB';
import { resolveOrgReviewConfig } from '@/libs/orgReview/config';
import { actionRunSchema, projectSchema } from '@/models/Schema';
import { deriveFindings } from './findings';
import { judgeFindings } from './judge';
import { readOrgSignals } from './signals';

/** The id the review's proposals are filed under — its own seat, never a real agent's ledger. */
export const ORG_REVIEW_AGENT = 'org-review';

/** Findings shown to the judge per proposal the review may file: room to say "none" to some. */
const JUDGED_PER_PROPOSAL = 3;

/** How long an Undo keeps the same change from being proposed again. */
const UNDONE_STANDS_DAYS = 30;

export type OrgReviewResult = {
  orgId: string;
  asOf: string;
  /** Why nothing ran, when nothing did. */
  skipped?: 'disabled' | 'no_project' | 'workspace_paused';
  findings: number;
  judged: JudgeOutcome['judged'] | null;
  filed: Array<{ runId: number; kind: string; target: string; outcome: string; status: string }>;
  /** Proposals that were not filed, with why: a precheck refusal, a decision a person already took, the cap. */
  notFiled: Array<{ kind: string; target: string; why: string }>;
  kept: Array<{ finding: string; reason: string }>;
  invalid: Array<{ finding: string | null; why: string }>;
  consolidation: { ran: boolean; result?: Record<string, number>; error?: string };
};

/**
 * The input an `org.change` proposal is filed with: the change, its words, and
 * the finding's evidence — core's, not the model's.
 * @param p - The judged proposal.
 * @param asOf - When the evidence was read.
 */
export function proposalInput(p: JudgedProposal, asOf: Date): OrgChangeInput {
  return {
    change: p.change,
    headline: p.headline.slice(0, 200),
    reason: p.reason.slice(0, 1_000),
    signal: p.finding.signal,
    evidence: p.finding.evidence.slice(0, 16),
    asOf: asOf.toISOString(),
  };
}

/**
 * Run one workspace's org review.
 * @param orgId - The workspace. Everything read and filed is scoped to it.
 * @param opts - The clock, a model for tests, and whether to run the learning compaction.
 * @param opts.now - The moment the evidence is read.
 * @param opts.model - Injected judge model (tests); the org's classifier otherwise.
 * @param opts.consolidate - Run the learning compaction when due (default true).
 * @param opts.force - Run even when the workspace turned the review off (an explicit request).
 */
export async function runOrgReview(orgId: string, opts: { now?: Date; model?: Pick<BaseChatModel, 'bindTools'>; consolidate?: boolean; force?: boolean } = {}): Promise<OrgReviewResult> {
  const now = opts.now ?? new Date();
  const base: OrgReviewResult = { orgId, asOf: now.toISOString(), findings: 0, judged: null, filed: [], notFiled: [], kept: [], invalid: [], consolidation: { ran: false } };
  const [project] = await db
    .select({ orgReview: projectSchema.orgReview, kind: projectSchema.kind })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return { ...base, skipped: 'no_project' };
  }
  const config = resolveOrgReviewConfig(project.orgReview, project.kind);
  if (!config.enabled && !opts.force) {
    return { ...base, skipped: 'disabled' };
  }
  // A workspace a person paused does nothing by itself, and a review filing
  // cards into it is something by itself (`services/workspacePause.ts`).
  const { readWorkspacePause } = await import('@/services/workspacePause');
  if (!opts.force && await readWorkspacePause(orgId)) {
    return { ...base, skipped: 'workspace_paused' };
  }

  const signals = await readOrgSignals(orgId, { now });
  const findings = deriveFindings(signals, config);
  const shown = findings.slice(0, Math.max(1, config.maxProposals * JUDGED_PER_PROPOSAL));
  const outcome = config.maxProposals > 0
    ? await judgeFindings({ orgId, workspace: signals.workspace, findings: shown }, opts.model)
    : { proposals: [], kept: [], invalid: [], judged: 'model' as const };

  const result: OrgReviewResult = {
    ...base,
    findings: findings.length,
    judged: outcome.judged,
    kept: outcome.kept.map(k => ({ finding: k.finding.id, reason: k.reason })),
    invalid: outcome.invalid.map(i => ({ finding: i.finding?.id ?? null, why: i.why })),
  };

  // Strongest finding first; the cap counts what reached Needs you.
  const ordered = [...outcome.proposals].sort((a, b) => b.finding.strength - a.finding.strength);
  const undone = await recentlyUndone(orgId, now);
  const { ActionError, proposeAction } = await import('@/services/ActionService');
  for (const p of ordered) {
    const target = orgChangeTarget(p.change);
    const undoneAt = undone.get(`org.change:${p.change.kind}:${target}`);
    if (undoneAt) {
      // A person put this exact change back; asking again next week is nagging.
      result.notFiled.push({ kind: p.change.kind, target, why: `a person undid this change on ${undoneAt.toISOString().slice(0, 10)}; it is not asked again for ${UNDONE_STANDS_DAYS} days` });
      continue;
    }
    if (result.filed.length >= config.maxProposals) {
      result.notFiled.push({ kind: p.change.kind, target, why: `over this review's cap of ${config.maxProposals}; it will be weighed again next week` });
      continue;
    }
    try {
      const res = await proposeAction({
        orgId,
        actionId: 'org.change',
        input: proposalInput(p, now) as unknown as Record<string, unknown>,
        principal: { kind: 'agent', id: `agent:${ORG_REVIEW_AGENT}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: `agent:${ORG_REVIEW_AGENT}`,
        // Core's own step: the evidence is the review's, kept on the input.
        internal: true,
        proposal: {
          confidence: p.confidence,
          rationale: p.reason,
          agentSlug: ORG_REVIEW_AGENT,
          suggestedDecision: 'approve',
          suggestedDecisionReason: p.headline,
        },
      });
      if (res.outcome === 'already_decided') {
        result.notFiled.push({ kind: p.change.kind, target, why: `a person already decided this (run ${res.runId}); it is not asked again for 30 days` });
        continue;
      }
      result.filed.push({ runId: res.runId, kind: p.change.kind, target, outcome: res.outcome, status: res.status });
    } catch (error) {
      // A refusal (the agent was retired since, the role was hired) says why
      // and the review moves on; anything else is a fault worth the log.
      const why = error instanceof ActionError ? error.message : `could not file: ${(error as Error).message}`;
      if (!(error instanceof ActionError)) {
        console.error(`[orgReview] filing ${p.change.kind} for ${target} in ${orgId} failed`, error);
      }
      result.notFiled.push({ kind: p.change.kind, target, why });
    }
  }

  if (opts.consolidate !== false) {
    result.consolidation = await consolidateWhenDue(orgId, now, config.staleRuleDays);
  }
  return result;
}

/**
 * The org changes a person undid recently, by dedup key, with when.
 * @param orgId - The workspace.
 * @param now - The clock.
 */
async function recentlyUndone(orgId: string, now: Date): Promise<Map<string, Date>> {
  const since = new Date(now.getTime() - UNDONE_STANDS_DAYS * 86_400_000);
  const rows = await db
    .select({ key: actionRunSchema.dedupKey, at: actionRunSchema.decidedAt, created: actionRunSchema.createdAt })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'org.change'),
      eq(actionRunSchema.status, 'undone'),
      gte(actionRunSchema.createdAt, since),
    ));
  return new Map(rows.filter(r => r.key).map(r => [r.key!, r.at ?? r.created]));
}

/**
 * Run the learning compaction for this workspace when its interval has passed.
 * Its failure is reported on the review's result and never fails the review.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param staleDays - The workspace's stale window.
 */
async function consolidateWhenDue(orgId: string, now: Date, staleDays: number): Promise<OrgReviewResult['consolidation']> {
  try {
    const { consolidationDue, runConsolidation } = await import('@/services/ConsolidationService');
    if (!await consolidationDue(orgId, now)) {
      return { ran: false };
    }
    return { ran: true, result: await runConsolidation(orgId, { now, staleDays }) };
  } catch (error) {
    console.error(`[orgReview] learning compaction failed for ${orgId}`, error);
    return { ran: false, error: (error as Error).message };
  }
}

/**
 * One line a log or a person reads about a review.
 * @param r - The result.
 */
export function orgReviewLine(r: OrgReviewResult): string {
  if (r.skipped) {
    return `org review ${r.orgId}: skipped (${r.skipped})`;
  }
  const compaction = r.consolidation.ran ? ', learning compaction ran' : '';
  return `org review ${r.orgId}: ${r.findings} finding(s), ${r.filed.length} filed, ${r.notFiled.length} not filed, ${r.kept.length} kept (${r.judged ?? 'no'} judgement)${compaction}`;
}
