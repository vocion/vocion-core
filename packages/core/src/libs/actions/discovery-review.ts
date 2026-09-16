/**
 * discovery.review_proposal — the review-queue item a detected discovery call
 * is surfaced as (ticket 011). Its input carries the classification summary so
 * the queue shows what the agent found; its `proposal` envelope carries the
 * confidence + reasoning.
 *
 * `external: true` is deliberate: an agent proposing it (autonomy 1) is gated
 * into the review queue rather than auto-executing — the v1 supervised
 * behaviour we want. Approving it now starts a `discovery-followup` mission
 * check (the retired discovery_followup workflow's replacement), which is
 * real downstream work, so the action is ALSO on ActionService's never-auto
 * list: no trust rule can release it without a human. That guard moved from
 * a comment to code the moment `execute` stopped being a marker.
 */

import type { Action } from './types';
import { z } from 'zod';

/** The mission the approved candidate is handed to. */
const FOLLOWUP_MISSION = 'discovery-followup';

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
  // The structured card. The object is NAMED for a human — the meeting, not
  // the generated "Discovery call detected: <serialized display name>" string
  // that used to be the H1 — and the entities are the several parties a
  // meeting actually involves rather than one field called "Company" holding
  // an email address (`docs/specs/discovery-ledger-v2.md`).
  //
  // Everything resolves fresh from the ledger row, so the card stays right
  // even if the proposal input predates a re-assessment.
  async reviewCard(ctx, input) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { discoveryCandidateSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
    const { readClassification, DISCOVERY_CLASS_LABEL, READINESS_CLASS_LABEL, REASON_CODE_LABEL } = await import('@/services/discovery/classification');
    const { entitiesFor } = await import('@/services/discovery/ledger');

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
    const attendees = (meetingMeta.attendees as unknown[] ?? []).filter((a): a is string => typeof a === 'string');
    const when = candidate?.meetingStart
      ? candidate.meetingStart.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
      : null;

    // The matched CRM record, for the entity block.
    const matchRef = candidate?.matchRef ?? input.company ?? null;
    const [crmDoc] = matchRef && /^(?:contacts|companies|deals):/.test(matchRef)
      ? await db
          .select({ metadata: knowledgeDocumentSchema.metadata, title: knowledgeDocumentSchema.title })
          .from(knowledgeDocumentSchema)
          .where(and(
            eq(knowledgeDocumentSchema.orgId, ctx.orgId),
            eq(knowledgeDocumentSchema.externalId, matchRef),
          ))
          .limit(1)
      : [];
    const [source] = await db
      .select({ configJson: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema)
      .where(and(
        eq(knowledgeSourceSchema.orgId, ctx.orgId),
        eq(knowledgeSourceSchema.slug, 'hubspot'),
      ))
      .limit(1);
    const portalId = (source?.configJson as { portalId?: string | number } | null)?.portalId;
    const entities = entitiesFor(
      matchRef,
      candidate?.matchType ?? 'calendly-external',
      crmDoc ? { metadata: (crmDoc.metadata ?? {}) as Record<string, unknown>, title: crmDoc.title } : null,
      attendees,
      null,
      portalId == null ? null : String(portalId),
    );

    fields.push({ label: 'Meeting', value: when ? `${meetingTitle} — ${when}` : meetingTitle, ...(shareUrl ? { href: shareUrl } : {}) });
    if (entities.opportunity) {
      fields.push({ label: 'Opportunity', value: entities.opportunity.label, ...(entities.opportunity.href ? { href: entities.opportunity.href } : {}) });
    }
    // An email address is not a company. When CRM resolution failed, say so and
    // show what is actually known — much safer than labelling an email "Company".
    fields.push(entities.accountResolved && entities.account
      ? { label: 'Account', value: entities.account.label, ...(entities.account.href ? { href: entities.account.href } : {}) }
      : { label: 'Account', value: entities.unresolvedKnown ? `Not resolved — ${entities.unresolvedKnown}` : 'Not resolved' });
    if (entities.sponsorDomain) {
      fields.push({ label: 'Sponsor / referral source', value: entities.sponsorDomain });
    }
    if (attendees.length > 0) {
      fields.push({ label: 'Attendees', value: attendees.join(' · ') });
    }

    const classification = readClassification(candidate?.classification);
    const route = candidate?.route ?? input.route;

    // "Approving will" states the EFFECT, transactionally. It never repeats a
    // score: a person deciding needs to know what happens next, and the scores
    // are already on the page with the class they belong to.
    const nextAction = route === 'generate'
      ? 'Create a draft proposal from this meeting and add it to Needs you for your review. Nothing is sent.'
      : route === 'confirm'
        ? 'Start the discovery follow-up: a call summary, then a draft follow-up email added to Needs you for your review. Nothing is sent.'
        : classification
          ? `Mark this assessment correct. No downstream workflow runs — Vocion classified this as ${REASON_CODE_LABEL[classification.reasonCode ?? 'insufficient-evidence'].toLowerCase()}.`
          : 'Mark this assessment correct. No downstream workflow runs.';

    const verdict = classification ? DISCOVERY_CLASS_LABEL[classification.classification] : 'Not assessed';
    const readiness = classification ? READINESS_CLASS_LABEL[classification.proposalReadiness] : null;

    return {
      // The H1 names the object; the subtitle says what kind of record it is.
      title: meetingTitle,
      object: {
        title: meetingTitle,
        subtitle: when ? `Discovery assessment · ${when}` : 'Discovery assessment',
        section: 'Discovery',
      },
      system: 'Discovery',
      confidenceSubject: verdict,
      recommendation: {
        headline: verdict,
        detail: [
          classification?.reasonCode ? REASON_CODE_LABEL[classification.reasonCode] : null,
          readiness,
        ].filter(Boolean).join(' · ') || undefined,
      },
      fields,
      // One sentence on the card; the long reasoning stays behind Evidence.
      summary: classification?.reasonSummary || classification?.reasoning,
      nextAction,
      verbs: { approve: 'Approve', reject: 'Reject' },
    };
  },
  async execute(ctx, input) {
    // `drop` is a human saying "not a discovery call". Record the correction
    // (calibration data for 020) and start nothing.
    if (input.route === 'drop') {
      return { confirmed: true, candidateId: input.candidateId, route: input.route, handoff: 'dropped' };
    }

    // Hand the approved candidate to the discovery-followup mission: one
    // RevOps Lead turn that reads the transcript through the gate
    // (read_discovery_transcript releases only approved candidates — this
    // approval is what unlocks it), follows the discovery-summary and
    // draft-followup-email skills, and proposes gmail.send for review.
    // A mission failure is left to throw: ActionService records the
    // action_run as `failed` with the message, which is the honest outcome.
    const { getMission, startMission } = await import('@/services/MissionService');
    const template = await getMission(ctx.orgId, FOLLOWUP_MISSION);
    if (!template) {
      throw new Error(`mission "${FOLLOWUP_MISSION}" not found — run workspace:apply`);
    }

    const run = await startMission({
      orgId: ctx.orgId,
      missionSlug: FOLLOWUP_MISSION,
      brief: [
        `A human just approved discovery candidate ${input.candidateId} (meeting ${input.meetingExternalId}${input.company ? `, company ${input.company}` : ''}, route ${input.route}). Complete ALL FOUR steps in this one run; the run is not done after the summary.`,
        `1) Read its transcript with read_discovery_transcript (candidate_id ${input.candidateId}).`,
        '2) Follow the discovery-summary skill (/skills/discovery-summary/SKILL.md) to produce the structured summary.',
        '3) Follow the draft-followup-email skill (/skills/draft-followup-email/SKILL.md) with the founder-voice playbook to draft the follow-up email.',
        '4) Propose the draft via propose_action with action gmail.send so it lands in Review. Never send it yourself. A run that ends without the propose_action call has failed its goal.',
      ].join(' '),
      title: `Discovery follow-up: ${input.company ?? input.meetingExternalId}`,
      mode: 'check',
      invokedBy: ctx.invokedBy ?? 'action:discovery.review_proposal',
    });

    return {
      confirmed: true,
      candidateId: input.candidateId,
      route: input.route,
      handoff: FOLLOWUP_MISSION,
      missionRunId: run.id,
      missionStatus: run.status,
    };
  },
};
