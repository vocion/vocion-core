/**
 * personalization.enroll — the review-queue item a briefed-and-drafted MQL is
 * surfaced as. The input carries the drafted sends and the recommended
 * EXISTING HubSpot sequence; the card renders them for a decision on either
 * surface (the review queue and the personalization console decide the same
 * run — ticket 023's rule).
 *
 * Approving ("Enroll") persists the reviewer's edited sends, enrolls the
 * contact into the recommended existing sequence in HubSpot, stages the
 * approved personalized copy on the contact as a note (the sequences API
 * carries no per-enrollment copy), and moves the lead's lane to
 * `handed_off`. Declining moves it to `held`. Nothing unapproved is ever
 * sent, and the action is on ActionService's never-auto list: no trust rule
 * can release an enrollment without a human.
 */

import type { Action } from './types';
import { z } from 'zod';

const sendSchema = z.object({
  step: z.number().int().positive(),
  /** Offset in the sequence's cadence, when the drafting pass knew it. */
  day: z.number().optional(),
  subject: z.string(),
  body: z.string().min(1),
});

const enrollInput = z.object({
  leadBriefId: z.number(),
  contactRef: z.string().min(1),
  contactName: z.string().min(1),
  companyName: z.string().optional(),
  /** The EXISTING sequence the reviewer enrolls into — never invented. */
  sequenceId: z.string().min(1),
  sequenceName: z.string().min(1),
  senderEmail: z.string().min(1),
  hubspotUserId: z.string().optional(),
  sends: z.array(sendSchema).min(1),
});

/**
 * `PAID_SOCIAL` → `Paid social`: the CRM enum, read as how someone arrived.
 * @param value
 */
function entranceLabel(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const personalizationEnrollAction: Action<typeof enrollInput> = {
  id: 'personalization.enroll',
  name: 'Enroll MQL in sequence',
  description: 'Enroll a reviewed MQL into the recommended existing HubSpot sequence, carrying the approved personalized sends.',
  inputSchema: enrollInput,
  grant: 'enroll_lead',
  external: true,
  sourceSlug: 'hubspot',
  // One queue item per contact: a re-fired sweep updates the pending item in
  // place, never duplicates it.
  dedupKeyFor: input => `personalization.enroll:${input.contactRef}`,
  // Back-link the queue item onto the lead so the personalization console
  // renders and decides the same run.
  async onProposed(ctx, input, runId) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { leadBriefSchema } = await import('@/models/Schema');
    await db
      .update(leadBriefSchema)
      .set({ reviewActionRunId: runId })
      .where(and(
        eq(leadBriefSchema.orgId, ctx.orgId),
        eq(leadBriefSchema.contactRef, input.contactRef),
      ));
  },
  // The full card template: subject, provenance, recommendation, the sends as
  // editable email content, and the research link. Everything resolves fresh
  // from the lead row, so the card stays right after a rewrite.
  async reviewCard(ctx, input) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { knowledgeSourceSchema, leadBriefSchema } = await import('@/models/Schema');

    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(
        eq(leadBriefSchema.orgId, ctx.orgId),
        eq(leadBriefSchema.contactRef, input.contactRef),
      ))
      .limit(1);

    // Contact deep link needs the portal id, read from the contacts source.
    const hubspotId = input.contactRef.split(':')[1];
    let contactHref: string | undefined;
    const [source] = await db
      .select({ configJson: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema)
      .where(and(
        eq(knowledgeSourceSchema.orgId, ctx.orgId),
        eq(knowledgeSourceSchema.slug, 'hubspot-contacts'),
      ))
      .limit(1);
    const portalId = (source?.configJson as { portalId?: string | number } | null)?.portalId;
    if (portalId && hubspotId) {
      contactHref = `https://app.hubspot.com/contacts/${portalId}/record/0-1/${hubspotId}`;
    }

    // MQL date: the true stage-entry date when the mirror carried one; the
    // arrival date otherwise, labeled "Arrived" — never presented as stage
    // timing the data lacks.
    const provenance: Array<{ label: string; value: string }> = [];
    if (lead?.entranceSource) {
      provenance.push({ label: 'Source', value: entranceLabel(lead.entranceSource) });
    }
    if (lead?.utmCampaign) {
      provenance.push({ label: 'Campaign', value: lead.utmCampaign });
    }
    if (lead?.mqlAt) {
      provenance.push({ label: 'Became MQL', value: DATE_FORMAT.format(lead.mqlAt) });
    } else if (lead?.arrivedAt) {
      provenance.push({ label: 'Arrived', value: DATE_FORMAT.format(lead.arrivedAt) });
    }

    const sends = input.sends;
    const days = sends.map(s => s.day).filter((d): d is number => d !== undefined);
    const span = days.length > 0 ? Math.max(...days) : undefined;
    const reason = lead?.recommendedSequence?.reason;

    return {
      title: 'New MQL ready to enroll',
      system: 'Personalization',
      subject: {
        name: input.contactName,
        role: lead?.contactTitle ?? undefined,
        company: input.companyName ?? lead?.companyName ?? undefined,
        href: contactHref,
      },
      provenance,
      recommendation: {
        headline: `Enroll in: ${input.sequenceName} · ${sends.length} ${sends.length === 1 ? 'send' : 'sends'}`,
        detail: reason,
        ref: input.sequenceId,
      },
      contentHeading: {
        label: `Outreach · ${sends.length} ${sends.length === 1 ? 'send' : 'sends'}`,
        meta: span !== undefined && span > 0 ? `${span} days` : undefined,
      },
      content: sends.map(s => ({
        kind: 'email' as const,
        id: `send-${s.step}`,
        label: s.day !== undefined ? `Day ${s.day}` : `Send ${s.step}`,
        subject: s.subject,
        body: s.body,
      })),
      fields: [],
      // The lead's own page — the card and the research land on one URL.
      links: [{ label: 'View Research', href: hubspotId ? `/gtm/lead/${hubspotId}` : '/gtm/personalization' }],
      verbs: { approve: 'Enroll', reject: 'Decline' },
    };
  },
  // Edit-then-approve on the sends: the reviewer's version is what persists
  // and what rides to the sender. Edits keep their step's day and order.
  applyContentEdits(input, edits) {
    const byId = new Map(edits.map(e => [e.id, e]));
    return {
      ...input,
      sends: input.sends.map((s) => {
        const edit = byId.get(`send-${s.step}`);
        if (!edit) {
          return s;
        }
        return {
          ...s,
          ...(edit.subject !== undefined ? { subject: edit.subject } : {}),
          ...(edit.body !== undefined ? { body: edit.body } : {}),
        };
      }),
    };
  },
  // Decline: lane → held, with the decision stamped. The reason lands on the
  // action_run and the assignment note through the decide path.
  async onRejected(ctx, input, _runId, _reason) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { leadBriefSchema } = await import('@/models/Schema');
    await db
      .update(leadBriefSchema)
      .set({
        status: 'held',
        decidedAt: new Date(),
        decidedBy: ctx.reviewedBy ?? ctx.invokedBy ?? null,
      })
      .where(and(
        eq(leadBriefSchema.orgId, ctx.orgId),
        eq(leadBriefSchema.contactRef, input.contactRef),
      ));
  },
  async execute(ctx, input) {
    const { createHubspotClient, tokenFromCredentials } = await import('@/libs/hubspot/client');
    const hubspotId = input.contactRef.split(':')[1];
    if (!hubspotId) {
      throw new Error(`contactRef "${input.contactRef}" carries no HubSpot id`);
    }
    // The `hubspot` source's vault token, or any credentialed hubspot-family
    // source (the workspace splits contacts/deals/companies into slugs).
    const token = tokenFromCredentials(ctx.credentials as Record<string, unknown> | undefined);
    let client = token ? createHubspotClient({ token }) : null;
    if (!client) {
      const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
      const resolved = await hubspotClientForOrg(ctx.orgId);
      if (!resolved.ok) {
        throw new Error('personalization.enroll requires connected HubSpot credentials (credentials.token)');
      }
      client = resolved.client;
    }

    // The enrollment: the lead is pushed into the recommended EXISTING
    // sequence. Throw-on-failure — the run records failed with the message.
    const { enrollContact, stageSendsAsNote } = await import('@/libs/hubspot/sequences');
    const enrolled = await enrollContact(client, {
      sequenceId: input.sequenceId,
      contactId: hubspotId,
      senderEmail: input.senderEmail,
      userId: input.hubspotUserId,
    });
    if (!enrolled.ok) {
      throw new Error(`HubSpot sequence enrollment failed: ${enrolled.message}`);
    }

    // The sequences API cannot carry per-enrollment copy, so the APPROVED
    // sends are staged for the sender on the contact's timeline. Non-fatal:
    // the enrollment already happened, and the result says which occurred.
    const noteBody = [
      `Approved personalized sends for "${input.sequenceName}" (reviewed in Vocion):`,
      ...input.sends.map(s => `Send ${s.step}${s.day !== undefined ? ` · Day ${s.day}` : ''}\nSubject: ${s.subject}\n\n${s.body}`),
    ].join('\n\n---\n\n');
    const note = await stageSendsAsNote(client, hubspotId, noteBody);

    // The lane flip: reviewed sends persist on the lead (the reviewer's
    // edited copy — decide() re-wrote the input before execution), and the
    // decision is stamped with who made it.
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { leadBriefSchema } = await import('@/models/Schema');
    await db
      .update(leadBriefSchema)
      .set({
        draftSequence: input.sends,
        status: 'handed_off',
        decidedAt: new Date(),
        decidedBy: ctx.reviewedBy ?? ctx.invokedBy ?? null,
      })
      .where(and(
        eq(leadBriefSchema.orgId, ctx.orgId),
        eq(leadBriefSchema.contactRef, input.contactRef),
      ));

    return {
      enrolled: true,
      enrollmentId: enrolled.data.id ?? null,
      sequenceId: input.sequenceId,
      sequenceName: input.sequenceName,
      contactRef: input.contactRef,
      senderEmail: input.senderEmail,
      sendCount: input.sends.length,
      sendsStagedAsNote: note.ok,
      noteId: note.ok ? note.data.noteId : null,
      ...(note.ok ? {} : { noteError: note.message }),
    };
  },
};
