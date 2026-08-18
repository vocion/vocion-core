/**
 * discovery.review_proposal — the review-queue item a detected discovery call
 * is surfaced as (ticket 011). Its input carries the classification summary so
 * the queue shows what the agent found; its `proposal` envelope carries the
 * confidence + reasoning.
 *
 * `external: true` is deliberate: an agent proposing it (autonomy 1) is gated
 * into the review queue rather than auto-executing — the v1 supervised
 * behaviour we want. Note this is the *default* gate, not an absolute: unlike
 * `gmail.send`, this action is not on ActionService's never-auto list, so an
 * org that adds a `trust_rule` for `discovery.review_proposal` above the
 * confidence threshold COULD auto-approve it. That is harmless today because
 * `execute` is only a hand-off marker — but when proposal generation (012/013)
 * is wired into `execute`, either add this action to the never-auto guard or
 * ensure no such trust rule exists, so a proposal is never generated+sent
 * without a human. Do not rely on this comment alone; enforce it in code then.
 */

import type { Action } from './types';
import { z } from 'zod';

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
  async execute(_ctx, input) {
    // v1 supervised: proposal generation (012/013) is not wired yet. Approving
    // records the confirmation; the hand-off lands when generation ships.
    return {
      confirmed: true,
      candidateId: input.candidateId,
      route: input.route,
      handoff: 'proposal-generation-pending',
    };
  },
};
