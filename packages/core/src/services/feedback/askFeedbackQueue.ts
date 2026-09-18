/**
 * An ask answered with a correction, queued for the feedback classifier.
 *
 * "Every interaction should make the system smarter" (docs/DESIGN-PRINCIPLES.md): a
 * person who rejects an ask with a reason, or answers "other" in their own
 * words, has just told the team what to do differently. Left on the ask row
 * that text is read once; classified, it can become a rule the agent reads
 * every turn — and the third person to say the same thing raises a count
 * instead of filing a third note.
 *
 * Same rules as review-queue and run-feedback signals: no note, no rule; the
 * decision is the classifier's prior (`reject` and `other` both correct).
 */

import type { Ask } from '@/services/AskService';
import { enqueue } from '@/services/FeedbackWorkerService';

/** Decisions that carry a correction when they come with a note. */
const CORRECTING_DECISIONS = new Set(['reject', 'other']);

/**
 * Queue one ask decision for learning, when there is text to learn from.
 *
 * Never throws: it rides on a decision the person already made, and losing a
 * queued job is recoverable while failing the decision is not.
 * @param opts
 * @param opts.ask - The ask as it was BEFORE the decision (for kind, agent, org).
 * @param opts.decision - What was chosen.
 * @param opts.note - What the person wrote, if anything.
 * @param opts.decidedBy
 */
export async function proposeLearningFromDecision(opts: {
  ask: Pick<Ask, 'id' | 'orgId' | 'agentSlug' | 'kind' | 'title'>;
  decision: string;
  note: string | null;
  decidedBy: string;
}): Promise<void> {
  const note = opts.note?.trim();
  if (!note || !CORRECTING_DECISIONS.has(opts.decision)) {
    return;
  }
  try {
    await enqueue({
      orgId: opts.ask.orgId,
      source: 'ask',
      externalId: `ask:${opts.ask.id}:decision`,
      payload: {
        // The question travels with the answer so the classifier knows what
        // the correction was a correction OF.
        text: `${opts.ask.title}\n\n${opts.decision === 'reject' ? 'Rejected' : 'Answered instead'}: ${note}`,
        agentSlug: opts.ask.agentSlug ?? undefined,
        submittedBy: opts.decidedBy,
        polarityHint: 'correct',
      },
    });
  } catch (error) {
    console.error(`[askFeedbackQueue] could not queue ask ${opts.ask.id} decision for learning`, error);
  }
}
