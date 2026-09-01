/**
 * LearningCandidateService — the queue of rules the system wants to adopt.
 *
 * The feedback worker classifies raw reviewer feedback and, when a
 * classification yields rule text, records a candidate here. Nothing becomes a
 * real `learning` rule until a person approves it, so the worker can be as
 * eager as it likes without ever changing how an agent behaves on its own.
 *
 * A rejection keeps its reason. That is the point of the table: over time the
 * rejected pile says as much about where the classifier is wrong as the
 * approved pile says about where it is right.
 *
 * Framework-free on purpose — the HTTP handlers and the dashboard both call
 * straight in.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { learningCandidateSchema } from '@/models/Schema';
import { addLearning, checkDedup } from '@/services/LearningsService';

export type LearningCandidate = typeof learningCandidateSchema.$inferSelect;

export type CandidateStatus = 'pending' | 'approved' | 'rejected';

const CANDIDATE_STATUSES: CandidateStatus[] = ['pending', 'approved', 'rejected'];

/**
 * Is this a status the table accepts? Guards values arriving from a query string.
 * @param value
 */
export function isCandidateStatus(value: unknown): value is CandidateStatus {
  return typeof value === 'string' && CANDIDATE_STATUSES.includes(value as CandidateStatus);
}

/**
 * The text a decision would actually adopt: the human's edit when there is one,
 * otherwise what the classifier proposed.
 * @param candidate
 */
export function effectiveRuleText(candidate: Pick<LearningCandidate, 'ruleText' | 'editedRuleText'>): string {
  const edited = candidate.editedRuleText?.trim();
  return edited && edited.length > 0 ? edited : candidate.ruleText;
}

export type ListCandidatesOptions = {
  status?: CandidateStatus;
  stepName?: string;
  limit?: number;
  offset?: number;
};

/**
 * A page of candidates for an org, newest first, with the total the filters
 * matched. Filtering, ordering and counting all run in the database.
 * @param orgId
 * @param opts
 */
export async function listCandidates(
  orgId: string,
  opts: ListCandidatesOptions = {},
): Promise<{ items: LearningCandidate[]; total: number; limit: number; offset: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const filters = [eq(learningCandidateSchema.orgId, orgId)];
  if (opts.status) {
    filters.push(eq(learningCandidateSchema.status, opts.status));
  }
  if (opts.stepName) {
    filters.push(eq(learningCandidateSchema.stepName, opts.stepName));
  }
  const where = and(...filters);

  const [items, [counted]] = await Promise.all([
    db
      .select()
      .from(learningCandidateSchema)
      .where(where)
      .orderBy(desc(learningCandidateSchema.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(learningCandidateSchema).where(where),
  ]);
  return { items, total: counted?.total ?? 0, limit, offset };
}

/**
 * One candidate, or `null` when this org does not own it. Scoping the lookup by
 * org is what makes a wrong id a 404 rather than another tenant's data.
 * @param orgId
 * @param id
 */
export async function getCandidate(orgId: string, id: number): Promise<LearningCandidate | null> {
  const [row] = await db
    .select()
    .from(learningCandidateSchema)
    .where(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Record a proposed rule. Called by the feedback worker; also useful directly
 * when something other than feedback suggests a rule.
 * @param opts
 * @param opts.orgId
 * @param opts.stepName
 * @param opts.ruleText
 * @param opts.sourceFeedbackJobId
 * @param opts.sourceRunId
 */
export async function createCandidate(opts: {
  orgId: string;
  stepName: string;
  ruleText: string;
  sourceFeedbackJobId?: number | null;
  sourceRunId?: number | null;
}): Promise<LearningCandidate> {
  const ruleText = opts.ruleText.trim();
  if (!ruleText) {
    throw new Error('rule text must not be empty');
  }
  const [row] = await db
    .insert(learningCandidateSchema)
    .values({
      orgId: opts.orgId,
      stepName: opts.stepName,
      ruleText,
      sourceFeedbackJobId: opts.sourceFeedbackJobId ?? null,
      sourceRunId: opts.sourceRunId ?? null,
      status: 'pending',
    })
    .returning();
  return row!;
}

export type UpdateCandidateResult
  = | { ok: true; candidate: LearningCandidate }
    | { ok: false; error: 'not_found' | 'already_decided' | 'empty_rule_text' };

/**
 * Edit a pending candidate before deciding it — reword the rule, or point it at
 * a different step. A decided candidate is history and cannot be edited.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.editedRuleText
 * @param opts.stepName
 */
export async function updateCandidate(opts: {
  orgId: string;
  id: number;
  editedRuleText?: string;
  stepName?: string;
}): Promise<UpdateCandidateResult> {
  const existing = await getCandidate(opts.orgId, opts.id);
  if (!existing) {
    return { ok: false, error: 'not_found' };
  }
  if (existing.status !== 'pending') {
    return { ok: false, error: 'already_decided' };
  }

  const patch: Partial<typeof learningCandidateSchema.$inferInsert> = {};
  if (opts.editedRuleText !== undefined) {
    const trimmed = opts.editedRuleText.trim();
    if (!trimmed) {
      return { ok: false, error: 'empty_rule_text' };
    }
    patch.editedRuleText = trimmed;
  }
  if (opts.stepName !== undefined) {
    patch.stepName = opts.stepName;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, candidate: existing };
  }

  const [row] = await db
    .update(learningCandidateSchema)
    .set(patch)
    .where(and(eq(learningCandidateSchema.orgId, opts.orgId), eq(learningCandidateSchema.id, opts.id)))
    .returning();
  return { ok: true, candidate: row! };
}

export type DecideCandidateResult
  = | { ok: true; candidate: LearningCandidate; ruleId: number | null }
    | { ok: false; error: 'not_found' | 'already_decided' | 'reason_required' | 'unknown_step' }
    | {
      ok: false;
      error: 'near_duplicate';
      existing: { existingId: number; existingRule: string; similarity: number };
    };

/**
 * Approve a candidate into a real rule, or reject it with a reason.
 *
 * Approval goes through `addLearning`, so the same near-duplicate guard that
 * protects a hand-written rule protects an approved one — a candidate that
 * restates a rule already on file is refused rather than quietly doubled up.
 * Rejection requires a reason on purpose.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.decision
 * @param opts.reason
 * @param opts.decidedBy
 */
export async function decideCandidate(opts: {
  orgId: string;
  id: number;
  decision: 'approve' | 'reject';
  reason?: string;
  decidedBy: string;
}): Promise<DecideCandidateResult> {
  const candidate = await getCandidate(opts.orgId, opts.id);
  if (!candidate) {
    return { ok: false, error: 'not_found' };
  }
  if (candidate.status !== 'pending') {
    return { ok: false, error: 'already_decided' };
  }

  if (opts.decision === 'reject') {
    const reason = opts.reason?.trim();
    if (!reason) {
      return { ok: false, error: 'reason_required' };
    }
    const [row] = await db
      .update(learningCandidateSchema)
      .set({ status: 'rejected', rejectedReason: reason, decidedBy: opts.decidedBy, decidedAt: new Date() })
      .where(and(eq(learningCandidateSchema.orgId, opts.orgId), eq(learningCandidateSchema.id, opts.id)))
      .returning();
    return { ok: true, candidate: row!, ruleId: null };
  }

  let added;
  try {
    added = await addLearning({
      orgId: opts.orgId,
      stepName: candidate.stepName,
      ruleText: effectiveRuleText(candidate),
      source: candidate.sourceFeedbackJobId ? `feedback:${candidate.sourceFeedbackJobId}` : 'learning-candidate',
      createdBy: opts.decidedBy,
    });
  } catch (error) {
    // addLearning throws only for an unknown step; anything else is a real fault.
    if (error instanceof Error && error.message.startsWith('unknown learning step')) {
      console.error(`[LearningCandidateService] candidate ${opts.id} targets unknown step "${candidate.stepName}"`, error);
      return { ok: false, error: 'unknown_step' };
    }
    throw error;
  }

  if (!added.ok) {
    return {
      ok: false,
      error: 'near_duplicate',
      existing: {
        existingId: added.existing.existingId,
        existingRule: added.existing.existingRule,
        similarity: added.existing.similarity,
      },
    };
  }

  const [row] = await db
    .update(learningCandidateSchema)
    .set({
      status: 'approved',
      createdLearningId: added.rule?.id ?? null,
      decidedBy: opts.decidedBy,
      decidedAt: new Date(),
    })
    .where(and(eq(learningCandidateSchema.orgId, opts.orgId), eq(learningCandidateSchema.id, opts.id)))
    .returning();
  return { ok: true, candidate: row!, ruleId: added.rule?.id ?? null };
}

/**
 * Would approving this text be refused as a near-duplicate? Lets a client warn
 * before it writes, instead of failing the write.
 * @param orgId
 * @param stepName
 * @param ruleText
 */
export async function checkCandidateText(orgId: string, stepName: string, ruleText: string) {
  return checkDedup(orgId, stepName, ruleText);
}
