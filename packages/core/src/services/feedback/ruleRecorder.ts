/**
 * The one place a proposed rule turns into queue state.
 *
 * Every path that produces rule text — a document comment, an external client
 * posting feedback, a reviewer rejecting or praising an agent's proposed
 * action — ends up here. The rule is compared against what already exists for
 * that learning step, and then either:
 *
 *   - it is a new idea, so a pending `learning_candidate` is written, or
 *   - it restates something pending or already adopted, so NOTHING new is
 *     written: the existing row's occurrence count goes up instead.
 *
 * Either way one `learning_feedback_occurrence` row records who said it and
 * what they wrote, so a reviewer looking at a candidate can read the evidence
 * behind it and see how many separate people asked.
 *
 * Nothing here auto-adopts a rule. A candidate is still a suggestion in a
 * queue; only a person approving it writes a `learning`.
 */

import type { ExistingRule } from './duplicateDetection';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  learningCandidateSchema,
  learningFeedbackOccurrenceSchema,
  learningSchema,
  learningStepSchema,
} from '@/models/Schema';
import { createCandidate } from '@/services/LearningCandidateService';
import { findDuplicateRule } from './duplicateDetection';

/** Which direction a piece of feedback points the agent. */
export type FeedbackPolarity = 'correct' | 'reinforce';

export type RecordProposedRuleResult
  = | { outcome: 'created'; candidateId: number; occurrenceId: number }
    | { outcome: 'duplicate'; matched: ExistingRule; occurrenceId: number; reason: string }
    | { outcome: 'skipped'; reason: 'empty_rule_text' | 'no_learning_step' };

/**
 * Resolve which learning step a rule should attach to.
 *
 * A caller that knows the step (a document comment naming its target) wins.
 * Review-queue feedback knows no step, so it lands on the org's first one —
 * the same fallback the inspection feedback route uses. An org with no steps
 * at all has nowhere to put a rule, and the caller is told so rather than
 * writing a candidate that can never be approved.
 * @param orgId
 * @param preferredStepName
 */
async function resolveStepName(orgId: string, preferredStepName?: string): Promise<string | null> {
  if (preferredStepName?.trim()) {
    return preferredStepName.trim();
  }
  const [firstStep] = await db
    .select({ name: learningStepSchema.name })
    .from(learningStepSchema)
    .where(eq(learningStepSchema.orgId, orgId))
    .orderBy(learningStepSchema.id)
    .limit(1);
  return firstStep?.name ?? null;
}

/**
 * Every rule already on file for this step — pending suggestions and adopted
 * rules together, since feedback can restate either one.
 *
 * A step name that does not exist yet is not an error: candidates may name a
 * step before anyone creates it, and in that case there is simply nothing to
 * compare against.
 * @param orgId
 * @param stepName
 */
async function loadExistingRules(orgId: string, stepName: string): Promise<ExistingRule[]> {
  // Newest first, because that is the order the shortlist fills its spare
  // slots in — a step with more rules than the shortlist holds should compare
  // against what the workspace is doing now, not what it did first.
  const pending = await db
    .select({ id: learningCandidateSchema.id, ruleText: learningCandidateSchema.ruleText })
    .from(learningCandidateSchema)
    .where(and(
      eq(learningCandidateSchema.orgId, orgId),
      eq(learningCandidateSchema.stepName, stepName),
      eq(learningCandidateSchema.status, 'pending'),
    ))
    .orderBy(desc(learningCandidateSchema.id));

  const [step] = await db
    .select({ id: learningStepSchema.id })
    .from(learningStepSchema)
    .where(and(eq(learningStepSchema.orgId, orgId), eq(learningStepSchema.name, stepName)));

  const adopted = step
    ? await db
        .select({ id: learningSchema.id, ruleText: learningSchema.ruleText })
        .from(learningSchema)
        .where(and(eq(learningSchema.orgId, orgId), eq(learningSchema.stepId, step.id)))
        .orderBy(desc(learningSchema.id))
    : [];

  return [
    ...pending.map(row => ({ kind: 'candidate' as const, id: row.id, ruleText: row.ruleText })),
    ...adopted.map(row => ({ kind: 'learning' as const, id: row.id, ruleText: row.ruleText })),
  ];
}

/**
 * Record one piece of feedback that proposed a rule.
 * @param opts
 * @param opts.orgId
 * @param opts.ruleText - The rule the classifier proposed.
 * @param opts.polarity - Whether the agent should change or keep its behaviour.
 * @param opts.stepName - Learning step to attach to; falls back to the org's first.
 * @param opts.note - What the person actually wrote, kept as evidence.
 * @param opts.agentSlug - The agent whose output drew the feedback.
 * @param opts.sourceFeedbackJobId - The queued job this came from, when there was one.
 * @param opts.sourceRunId - The run being reacted to, when there was one.
 * @param opts.submittedBy - The person who gave the feedback.
 */
export async function recordProposedRule(opts: {
  orgId: string;
  ruleText: string;
  polarity: FeedbackPolarity;
  stepName?: string;
  note?: string | null;
  agentSlug?: string | null;
  sourceFeedbackJobId?: number | null;
  sourceRunId?: number | null;
  submittedBy?: string | null;
}): Promise<RecordProposedRuleResult> {
  const ruleText = opts.ruleText.trim();
  if (!ruleText) {
    return { outcome: 'skipped', reason: 'empty_rule_text' };
  }
  const stepName = await resolveStepName(opts.orgId, opts.stepName);
  if (!stepName) {
    return { outcome: 'skipped', reason: 'no_learning_step' };
  }

  const existing = await loadExistingRules(opts.orgId, stepName);
  const verdict = await findDuplicateRule({
    orgId: opts.orgId,
    stepName,
    ruleText,
    existing,
  });

  if (verdict.duplicate) {
    const occurrenceId = await attachOccurrence(verdict.matched, {
      orgId: opts.orgId,
      polarity: opts.polarity,
      note: opts.note ?? null,
      agentSlug: opts.agentSlug ?? null,
      sourceFeedbackJobId: opts.sourceFeedbackJobId ?? null,
      sourceRunId: opts.sourceRunId ?? null,
      submittedBy: opts.submittedBy ?? null,
    });
    await trackRuleEvent('learning.candidate_duplicate', opts, {
      polarity: opts.polarity,
      matchedKind: verdict.matched.kind,
    });
    return { outcome: 'duplicate', matched: verdict.matched, occurrenceId, reason: verdict.reason };
  }

  const candidate = await createCandidate({
    orgId: opts.orgId,
    stepName,
    ruleText,
    polarity: opts.polarity,
    sourceFeedbackJobId: opts.sourceFeedbackJobId ?? null,
    sourceRunId: opts.sourceRunId ?? null,
  });
  const occurrenceId = await attachOccurrence(
    { kind: 'candidate', id: candidate.id, ruleText },
    {
      orgId: opts.orgId,
      polarity: opts.polarity,
      note: opts.note ?? null,
      agentSlug: opts.agentSlug ?? null,
      sourceFeedbackJobId: opts.sourceFeedbackJobId ?? null,
      sourceRunId: opts.sourceRunId ?? null,
      submittedBy: opts.submittedBy ?? null,
    },
    // The candidate row starts at 1 for this very occurrence — bumping it
    // here would count the first piece of feedback twice.
    true,
  );
  await trackRuleEvent('learning.candidate_created', opts, { polarity: opts.polarity });
  return { outcome: 'created', candidateId: candidate.id, occurrenceId };
}

/**
 * Write the occurrence row and raise the target's count.
 *
 * A newly created candidate already starts at 1 for its own first occurrence,
 * so the count is only raised for a target that already existed.
 * @param target
 * @param row
 * @param row.orgId
 * @param row.polarity
 * @param row.note
 * @param row.agentSlug
 * @param row.sourceFeedbackJobId
 * @param row.sourceRunId
 * @param row.submittedBy
 * @param isFirstOccurrence
 */
async function attachOccurrence(
  target: ExistingRule,
  row: {
    orgId: string;
    polarity: FeedbackPolarity;
    note: string | null;
    agentSlug: string | null;
    sourceFeedbackJobId: number | null;
    sourceRunId: number | null;
    submittedBy: string | null;
  },
  isFirstOccurrence = false,
): Promise<number> {
  const [occurrence] = await db
    .insert(learningFeedbackOccurrenceSchema)
    .values({
      orgId: row.orgId,
      candidateId: target.kind === 'candidate' ? target.id : null,
      learningId: target.kind === 'learning' ? target.id : null,
      polarity: row.polarity,
      note: row.note,
      agentSlug: row.agentSlug,
      sourceFeedbackJobId: row.sourceFeedbackJobId,
      sourceRunId: row.sourceRunId,
      submittedBy: row.submittedBy,
    })
    .returning({ id: learningFeedbackOccurrenceSchema.id });

  if (!isFirstOccurrence) {
    if (target.kind === 'candidate') {
      await db
        .update(learningCandidateSchema)
        .set({ occurrenceCount: sql`${learningCandidateSchema.occurrenceCount} + 1` })
        .where(eq(learningCandidateSchema.id, target.id));
    } else {
      await db
        .update(learningSchema)
        .set({ occurrenceCount: sql`${learningSchema.occurrenceCount} + 1` })
        .where(eq(learningSchema.id, target.id));
    }
  }

  return occurrence!.id;
}

/**
 * Put the outcome on the adoption stream, so the dashboard that measures
 * disagreement can also see the rules disagreement produced.
 *
 * Fire-and-forget, like every other `track` call: telemetry never breaks the
 * write it rides on. Feedback with no known submitter is attributed to
 * 'system', which the read side already skips for per-user metrics.
 * @param eventType
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.submittedBy
 * @param meta
 * @param meta.polarity
 * @param meta.matchedKind
 */
async function trackRuleEvent(
  eventType: 'learning.candidate_created' | 'learning.candidate_duplicate',
  opts: { orgId: string; agentSlug?: string | null; submittedBy?: string | null },
  meta: { polarity: FeedbackPolarity; matchedKind?: 'candidate' | 'learning' },
): Promise<void> {
  const { track } = await import('@/services/adoption/track');
  await track(
    { orgId: opts.orgId, userId: opts.submittedBy ?? 'system' },
    eventType,
    { agentSlug: opts.agentSlug ?? undefined, meta },
  );
}
