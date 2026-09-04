/**
 * Thumbs-up and thumbs-down on a run, queued for the feedback classifier.
 *
 * The rating itself was already measured; what was going nowhere was the note.
 * A workflow or mission run stores `feedbackNote` on its own row, so the text
 * was never lost — it just never reached the classifier, which meant "the
 * summary buried the number again" sat in a column nobody read.
 *
 * Same two rules as review-queue signals: a rating with no note proposes no
 * rule, and the direction of the rating is the classifier's prior.
 */

import { enqueue } from '@/services/FeedbackWorkerService';

/** Which run surfaces collect a rating plus a note. */
export type RunFeedbackKind = 'workflow' | 'mission';

/**
 * Queue one run-feedback submission, when there is text to learn from.
 *
 * Never throws: it rides on a write the user already completed, and losing a
 * queued job is recoverable while failing the submission is not.
 * @param opts
 * @param opts.orgId
 * @param opts.kind - Which kind of run was rated.
 * @param opts.runId
 * @param opts.rating - Up, down, or cleared.
 * @param opts.note - What the person wrote, if anything.
 * @param opts.submittedBy
 */
export async function queueRunFeedbackForLearning(opts: {
  orgId: string;
  kind: RunFeedbackKind;
  runId: number;
  rating: 'up' | 'down' | null;
  note: string | null;
  submittedBy?: string;
}): Promise<void> {
  const note = opts.note?.trim();
  if (!note || !opts.rating) {
    return;
  }
  try {
    await enqueue({
      orgId: opts.orgId,
      source: 'review',
      externalId: `${opts.kind}_run:${opts.runId}:feedback`,
      payload: {
        text: note,
        agentSlug: await resolveAgentSlug(opts.orgId, opts.kind, opts.runId),
        sourceRunId: opts.runId,
        submittedBy: opts.submittedBy,
        polarityHint: opts.rating === 'up' ? 'reinforce' : 'correct',
      },
    });
  } catch (error) {
    console.error(`[runFeedbackQueue] could not queue ${opts.kind} run ${opts.runId} feedback for learning`, error);
  }
}

/**
 * Which agent the run belongs to, reusing the same resolver the adoption
 * stream uses so a rule and its metric agree on attribution.
 * @param orgId
 * @param kind
 * @param runId
 */
async function resolveAgentSlug(orgId: string, kind: RunFeedbackKind, runId: number): Promise<string | undefined> {
  const { resolveRunAgentSlug } = await import('@/services/adoption/attribution');
  const slug = await resolveRunAgentSlug(orgId, kind, runId);
  return slug ?? undefined;
}
