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
  agentSchema,
  learningCandidateSchema,
  learningFeedbackOccurrenceSchema,
  memoryNamespaceSchema,
} from '@/models/Schema';
import { createCandidate } from '@/services/LearningCandidateService';
import { bumpOccurrence, getNamespace } from '@/services/MemoryService';
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
 * @param input
 * @param input.preferred
 * @param input.agentSteps
 * @param input.workspaceSteps
 */
export function pickStepName(input: {
  preferred?: string | null;
  /** The steps this agent declares, in the order it declares them. */
  agentSteps?: readonly string[];
  /** Every step that exists in the workspace, oldest first. */
  workspaceSteps: readonly string[];
}): string | null {
  const preferred = input.preferred?.trim();
  if (preferred) {
    return preferred;
  }
  // The agent's OWN first declared step, when it declares one that exists. A
  // correction about client documents belongs with the writer that made the
  // document, not in the workspace-wide bucket where it would mount for every
  // agent (observed live 2026-09-20: a rule about proposals landed in
  // `global`, because the only fallback was "the workspace's oldest step").
  const own = (input.agentSteps ?? []).map(s => s.trim()).filter(Boolean).find(s => input.workspaceSteps.includes(s));
  return own ?? input.workspaceSteps[0] ?? null;
}

async function resolveStepName(orgId: string, preferredStepName?: string, agentSlug?: string | null): Promise<string | null> {
  if (preferredStepName?.trim()) {
    return preferredStepName.trim();
  }
  const [steps, agentSteps] = await Promise.all([
    db
      .select({ name: memoryNamespaceSchema.name })
      .from(memoryNamespaceSchema)
      .where(eq(memoryNamespaceSchema.orgId, orgId))
      .orderBy(memoryNamespaceSchema.id),
    agentSlug
      ? db
          .select({ learningSteps: agentSchema.learningSteps })
          .from(agentSchema)
          .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)))
          .limit(1)
      : Promise.resolve([] as Array<{ learningSteps: string[] }>),
  ]);
  return pickStepName({
    preferred: preferredStepName ?? null,
    agentSteps: agentSteps[0]?.learningSteps ?? [],
    workspaceSteps: steps.map(s => s.name),
  });
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

  // Adopted rules live in the memory store now; an unknown namespace is not
  // an error (candidates may name one before workspace:apply seeds it), so
  // there is simply nothing adopted to compare against.
  let adopted: Array<{ key: string; ruleText: string; createdAt: Date }> = [];
  try {
    adopted = (await getNamespace(orgId, stepName)).rules;
  } catch {
    adopted = [];
  }
  adopted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return [
    ...pending.map(row => ({ kind: 'candidate' as const, id: row.id, ruleText: row.ruleText })),
    ...adopted.map(row => ({ kind: 'learning' as const, id: row.key, ruleText: row.ruleText })),
  ];
}

/**
 * Record one piece of feedback that proposed a rule.
 * @param opts
 * @param opts.orgId
 * @param opts.ruleText - The rule the classifier proposed.
 * @param opts.polarity - Whether the agent should change or keep its behaviour.
 * @param opts.stepName - Learning step to attach to; falls back to the org's first.
 * @param opts.memoryType
 * @param opts.scopeKind
 * @param opts.scopeRef
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
  /** 'preference' | 'knowledge' | 'procedure' — the classifier's proposal, editable on the card. */
  memoryType?: string;
  /** Scope the rule lands at on approval; unset means the workspace step named above. */
  scopeKind?: 'agent' | 'user' | 'object';
  scopeRef?: string;
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
  const stepName = await resolveStepName(opts.orgId, opts.stepName, opts.agentSlug ?? null);
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
    memoryType: opts.memoryType,
    scopeKind: opts.scopeKind,
    scopeRef: opts.scopeRef,
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
      candidateId: target.kind === 'candidate' ? (target.id as number) : null,
      memoryKey: target.kind === 'learning' ? (target.id as string) : null,
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
        .where(eq(learningCandidateSchema.id, target.id as number));
    } else {
      await bumpOccurrence(row.orgId, target.id as string);
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
