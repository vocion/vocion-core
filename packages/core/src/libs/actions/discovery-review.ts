/**
 * discovery.review_proposal — the review-queue item a detected discovery call
 * is surfaced as (ticket 011). Its input carries the classification summary so
 * the queue shows what the agent found; its `proposal` envelope carries the
 * confidence + reasoning.
 *
 * `external: true` is deliberate: an agent proposing it (autonomy 1) is gated
 * into the review queue rather than auto-executing — the v1 supervised
 * behaviour we want. Approving it now starts the `discovery_followup` workflow,
 * which is real downstream work, so the action is ALSO on ActionService's
 * never-auto list: no trust rule can release it without a human. That guard
 * moved from a comment to code the moment `execute` stopped being a marker.
 */

import type { Action } from './types';
import { z } from 'zod';

/** The workflow the approved candidate is handed to. */
const FOLLOWUP_WORKFLOW = 'discovery_followup';

const discoveryReviewInput = z.object({
  candidateId: z.number(),
  meetingExternalId: z.string().min(1),
  company: z.string().nullable().optional(),
  route: z.enum(['generate', 'confirm', 'drop']),
  isDiscovery: z.boolean(),
  proposalReady: z.boolean(),
});

export const discoveryReviewProposalAction: Action<typeof discoveryReviewInput> = {
  id: 'discovery.review_proposal',
  name: 'Review discovery call → proposal',
  description: 'Confirm a detected discovery call and hand it to proposal generation.',
  inputSchema: discoveryReviewInput,
  grant: 'review_proposal',
  external: true,
  async execute(ctx, input) {
    // `drop` is a human saying "not a discovery call". Record the correction
    // (calibration data for 020) and start nothing.
    if (input.route === 'drop') {
      return { confirmed: true, candidateId: input.candidateId, route: input.route, handoff: 'dropped' };
    }

    // Fetch the transcript through the content gate, not around it: the gate
    // re-checks that a candidate row exists for this meeting, so an approval
    // can't smuggle a read of an unmatched call. Passing it to the workflow is
    // what lets the follow-up skip asking a human to paste what we already hold.
    const { readMatchedTranscript } = await import('@/services/DiscoveryDetectionService');
    const { startWorkflow } = await import('@/services/WorkflowService');

    // A gate refusal or missing transcript is left to throw: ActionService
    // records the action_run as `failed` with the message, which is the honest
    // outcome. Catching it here would mark the run `done` and read as a
    // successful hand-off in every list view. The human's decision is still
    // captured (the row keeps its input and reviewer), so the calibration
    // signal for 020 survives either way.
    const transcript = await readMatchedTranscript(ctx.orgId, input.meetingExternalId);

    const run = await startWorkflow({
      orgId: ctx.orgId,
      slug: FOLLOWUP_WORKFLOW,
      input: {
        transcript,
        meeting_external_id: input.meetingExternalId,
        prospect_company: input.company ?? null,
      },
      triggerContext: {
        source: 'discovery.review_proposal',
        candidateId: input.candidateId,
        route: input.route,
      },
      invokedBy: ctx.invokedBy ?? 'action:discovery.review_proposal',
    });

    return {
      confirmed: true,
      candidateId: input.candidateId,
      route: input.route,
      handoff: FOLLOWUP_WORKFLOW,
      workflowRunId: run.id,
      workflowStatus: run.status,
    };
  },
};
