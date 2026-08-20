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
  // One queue item per meeting, however the proposal was made: the hourly
  // agent check re-proposing the same call updates the pending item in place.
  dedupKeyFor: input => `discovery.review_proposal:${input.meetingExternalId}`,
  // Back-link the queue item onto the ledger row so "what happened to this
  // assessed call" is one query — status flips to routed the moment it is
  // in front of a human.
  async onProposed(ctx, input, runId) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { discoveryCandidateSchema } = await import('@/models/Schema');
    await db
      .update(discoveryCandidateSchema)
      .set({ status: 'routed', reviewActionRunId: runId })
      .where(and(
        eq(discoveryCandidateSchema.orgId, ctx.orgId),
        eq(discoveryCandidateSchema.id, input.candidateId),
      ));
  },
  // The structured card: Meeting (linked to Zoom), Company (linked to
  // HubSpot), summary of what the classifier found, and what approving does.
  // Everything resolves fresh from the ledger row, so the card stays right
  // even if the proposal input predates a re-assessment.
  async reviewCard(ctx, input) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { discoveryCandidateSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');

    const [candidate] = await db
      .select()
      .from(discoveryCandidateSchema)
      .where(and(
        eq(discoveryCandidateSchema.orgId, ctx.orgId),
        eq(discoveryCandidateSchema.id, input.candidateId),
      ))
      .limit(1);

    const fields: Array<{ label: string; value: string; href?: string }> = [];

    // Meeting → Zoom. The connector stamps shareUrl on newly-synced
    // recordings; older rows render the name without a link.
    const meetingTitle = candidate?.meetingTitle ?? input.meetingExternalId;
    const [meetingDoc] = candidate?.meetingDocId == null
      ? []
      : await db
          .select({ metadata: knowledgeDocumentSchema.metadata })
          .from(knowledgeDocumentSchema)
          .where(and(
            eq(knowledgeDocumentSchema.orgId, ctx.orgId),
            eq(knowledgeDocumentSchema.id, candidate!.meetingDocId!),
          ))
          .limit(1);
    const meetingMeta = (meetingDoc?.metadata ?? {}) as Record<string, unknown>;
    const shareUrl = typeof meetingMeta.shareUrl === 'string' ? meetingMeta.shareUrl : undefined;
    const start = candidate?.meetingStart
      ? ` — ${candidate.meetingStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : '';
    fields.push({ label: 'Meeting', value: `${meetingTitle}${start}`, ...(shareUrl ? { href: shareUrl } : {}) });

    // Company → HubSpot. matchRef is `contacts:9` / `companies:5` / `deals:3`
    // (or a bare domain for calendly-external). The record link needs the
    // portal id, read from the hubspot source config when set.
    const matchRef = candidate?.matchRef ?? input.company ?? null;
    if (matchRef) {
      const refMatch = /^(contacts|companies|deals):(.+)$/.exec(matchRef);
      if (refMatch) {
        const objectType = refMatch[1] as 'contacts' | 'companies' | 'deals';
        const hubspotId = refMatch[2]!;
        const [crmDoc] = await db
          .select({ metadata: knowledgeDocumentSchema.metadata, title: knowledgeDocumentSchema.title })
          .from(knowledgeDocumentSchema)
          .where(and(
            eq(knowledgeDocumentSchema.orgId, ctx.orgId),
            eq(knowledgeDocumentSchema.externalId, matchRef),
          ))
          .limit(1);
        const crmMeta = (crmDoc?.metadata ?? {}) as Record<string, unknown>;
        // Company first (a contact match should still read as the company),
        // then the record's own name, then whatever identifies it.
        const label = [crmMeta.company, crmMeta.name, crmMeta.domain, crmMeta.primaryEmail, crmDoc?.title]
          .find((v): v is string => typeof v === 'string' && v.length > 0) ?? matchRef;
        const [source] = await db
          .select({ configJson: knowledgeSourceSchema.configJson })
          .from(knowledgeSourceSchema)
          .where(and(
            eq(knowledgeSourceSchema.orgId, ctx.orgId),
            eq(knowledgeSourceSchema.slug, 'hubspot'),
          ))
          .limit(1);
        const portalId = (source?.configJson as { portalId?: string | number } | null)?.portalId;
        const typeCode = { contacts: '0-1', companies: '0-2', deals: '0-3' }[objectType];
        fields.push({
          label: 'Company',
          value: label,
          ...(portalId ? { href: `https://app.hubspot.com/contacts/${portalId}/record/${typeCode}/${hubspotId}` } : {}),
        });
      } else {
        // Calendly-external: the matched external domain, no CRM record yet.
        fields.push({ label: 'Company', value: `${matchRef} (not in CRM yet)` });
      }
    }

    const classification = candidate?.classification;
    const route = candidate?.route ?? input.route;
    const scores = classification
      ? ` (discovery ${Math.round(classification.isDiscoveryConfidence * 100)}%, proposal-ready ${Math.round(classification.proposalReadyConfidence * 100)}%)`
      : '';
    const nextAction = route === 'generate'
      ? `Generate the proposal${scores}. Approving starts the discovery follow-up: call summary, then a draft email for your review.`
      : route === 'confirm'
        ? `Confirm first${scores}: a discovery call, but not clearly proposal-ready. Approving starts the follow-up; reject if it should wait for another conversation.`
        : `Drop${scores}: the classifier says this is not a discovery call. Approving records your confirmation for calibration; nothing else runs.`;

    return {
      title: `Discovery call detected: ${meetingTitle}`,
      system: 'Discovery',
      fields,
      summary: classification?.reasoning,
      nextAction,
    };
  },
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
