/**
 * personalization.enroll — the review-queue item a briefed-and-drafted MQL is
 * surfaced as. The input carries the drafted sends and the recommended
 * EXISTING HubSpot sequence; the card renders them for a decision on either
 * surface (the review queue and the personalization console decide the same
 * run — ticket 023's rule).
 *
 * Approving ("Enroll") persists the reviewer's edited sends, writes them into
 * the contact's Personalized Nurture slots when the sequence is a ladder rung
 * (the ladder sends whatever those properties hold, so this happens BEFORE
 * the enrollment and a failed write stops it; ticket 060), enrolls the
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

/**
 * The contacts source's config: the portal id for deep links and the nurture
 * slot names. Absent source, absent keys, both read as defaults.
 * @param orgId
 */
async function contactsSourceConfig(orgId: string): Promise<{ portalId?: string | number; nurtureSlots?: unknown }> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const [source] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      eq(knowledgeSourceSchema.slug, 'hubspot-contacts'),
    ))
    .limit(1);
  return (source?.configJson as { portalId?: string | number; nurtureSlots?: unknown } | null) ?? {};
}

/**
 * What the scoped regenerate turn must answer with: either the full new draft
 * (every send, edited or not, plus the recommendation) or a routing to the
 * research fallback. Writes stay impossible structurally — the turn returns
 * data and the SERVER saves it through the same validate + save + propose
 * path as the hourly pass.
 */
const regenerateTurnOutput = z.object({
  /** True when the note invalidates the research itself — the full pass takes over. */
  needsResearch: z.boolean(),
  /**
   * Why it needs research (required with needsResearch), or the
   * recommendation's reason otherwise. Absent fields are `.nullish()`
   * throughout: a model answering `needsResearch` naturally writes
   * `"sends": null`, and refusing the null costs a corrective retry.
   */
  reason: z.string().nullish(),
  sends: z.array(z.object({
    day: z.number().int().min(0).nullish(),
    subject: z.string().min(1),
    body: z.string().min(1),
  })).min(1).max(10).nullish(),
  recommendedSequence: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    reason: z.string().nullish(),
  }).nullish(),
  senderEmail: z.string().min(1).nullish(),
  hubspotUserId: z.string().nullish(),
}).superRefine((v, sctx) => {
  if (!v.needsResearch) {
    if (!v.sends || v.sends.length === 0) {
      sctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sends is required (the full ordered list) unless needsResearch is true' });
    }
    if (!v.recommendedSequence) {
      sctx.addIssue({ code: z.ZodIssueCode.custom, message: 'recommendedSequence is required unless needsResearch is true' });
    }
  }
});

type FastRegenerateOutcome = { done: true } | { done: false; reason?: string };

/**
 * The fast path: one scoped turn of the workspace's mapped regenerate skill
 * over the existing brief + current sends (+ the live sequence library when
 * it could be read ahead), saved through `saveDraftSequence`. Returns
 * `done: false` when the turn routes the note to research.
 * @param opts
 * @param opts.ctx
 * @param opts.ctx.orgId
 * @param opts.ctx.invokedBy
 * @param opts.ctx.reviewedBy
 * @param opts.input - The pending run's current input (the sends the reviewer saw).
 * @param opts.lead - The full lead_brief row behind the card.
 * @param opts.skillSlug - The workspace's mapped regenerate composition.
 * @param opts.feedback
 */
async function regenerateSequenceCopy(opts: {
  ctx: { orgId: string; invokedBy?: string; reviewedBy?: string };
  input: z.infer<typeof enrollInput>;
  lead: typeof import('@/models/Schema').leadBriefSchema.$inferSelect;
  skillSlug: string;
  feedback: string;
}): Promise<FastRegenerateOutcome> {
  const { ctx, input, lead, skillSlug, feedback } = opts;
  const { logger } = await import('@/libs/Logger');

  // The library, read ahead so the common case needs no lookup at all.
  // Best-effort: a failed read leaves the tool for the model to try.
  let libraryBlock = 'The library could not be read ahead. Call hubspot_list_sequences if the note requires re-identifying the sequence.';
  try {
    const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
    const resolved = await hubspotClientForOrg(ctx.orgId);
    if (resolved.ok) {
      const { listSequences, resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
      const user = await resolveHubspotUserId(resolved.client, input.senderEmail);
      if (user.ok) {
        const sequences = await listSequences(resolved.client, user.data.userId);
        if (sequences.ok) {
          libraryBlock = JSON.stringify({ userEmail: input.senderEmail, userId: user.data.userId, sequences: sequences.data }, null, 2);
        }
      }
    }
  } catch (err) {
    logger.warn('regenerate fast path: library pre-read failed — the turn keeps its tool', {
      orgId: ctx.orgId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const { runSkillTurn } = await import('@/services/agents/skillTurn');
  const { output, toolCalls, durationMs } = await runSkillTurn({
    orgId: ctx.orgId,
    skillSlug,
    userId: ctx.reviewedBy,
    task: [
      `A reviewer pressed Regenerate on the enroll card for ${input.contactName} (${input.contactRef}) with this feedback:`,
      `"${feedback}"`,
      'Follow the skill: rewrite what the note asks and keep the rest, or answer needsResearch when the note falls outside what a redraft can fix.',
    ].join('\n\n'),
    context: [
      {
        title: 'Lead brief (the research behind the card — unchanged by this turn)',
        body: JSON.stringify({
          contactRef: lead.contactRef,
          contactName: lead.contactName,
          contactTitle: lead.contactTitle,
          companyName: lead.companyName,
          entranceSource: lead.entranceSource,
          utmCampaign: lead.utmCampaign,
          confidence: lead.confidence,
          sections: lead.sections,
          claims: lead.claims,
          missing: lead.missing,
          engagement: { sent: lead.engagementSent, opened: lead.engagementOpened },
        }, null, 2),
      },
      {
        title: 'Current recommendation and sends (what the reviewer saw)',
        body: JSON.stringify({
          sequenceId: input.sequenceId,
          sequenceName: input.sequenceName,
          senderEmail: input.senderEmail,
          hubspotUserId: input.hubspotUserId,
          sends: input.sends,
        }, null, 2),
      },
      { title: 'Sender\'s sequence library (HubSpot live)', body: libraryBlock },
    ],
    outputSchema: regenerateTurnOutput,
    outputInstruction: 'Fields: needsResearch (boolean); reason (string; why research is needed, or the recommendation\'s reason); sends (the FULL ordered list, each {subject, body, day?}, required unless needsResearch); recommendedSequence ({id, name, reason?}, ids exactly as the library returned them, required unless needsResearch); senderEmail and hubspotUserId (echo the current ones unless the library read changed them).',
    toolAllowlist: ['get_lead_brief', 'hubspot_list_sequences'],
  });

  if (output.needsResearch) {
    logger.info('regenerate fast path routed to research', { orgId: ctx.orgId, contactRef: input.contactRef, reason: output.reason, durationMs });
    return { done: false, reason: output.reason ?? undefined };
  }

  // The same terminal write as the hourly pass: validate the sequence against
  // the live library, save the sends, re-propose — the dedup refresh updates
  // the SAME pending run and clears the regenerating stamp.
  const { saveDraftSequence } = await import('@/services/PersonalizationQueueService');
  const saved = await saveDraftSequence(ctx.orgId, {
    contactRef: input.contactRef,
    // Nulls normalized away: the persisted shape carries a key or nothing.
    sends: output.sends!.map(s => ({ subject: s.subject, body: s.body, ...(s.day != null ? { day: s.day } : {}) })),
    recommendedSequence: {
      id: output.recommendedSequence!.id,
      name: output.recommendedSequence!.name,
      ...(output.recommendedSequence!.reason != null ? { reason: output.recommendedSequence!.reason } : {}),
    },
    senderEmail: output.senderEmail ?? input.senderEmail,
    hubspotUserId: output.hubspotUserId ?? input.hubspotUserId,
  });
  if (!saved.saved) {
    throw new Error(`regenerate fast path could not save the redraft: ${saved.message ?? saved.reason ?? 'unknown'}`);
  }
  logger.info('regenerate fast path landed', {
    orgId: ctx.orgId,
    contactRef: input.contactRef,
    reviewRunId: saved.reviewRunId,
    sendCount: saved.sendCount,
    toolCalls,
    durationMs,
  });
  return { done: true };
}

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
    const { leadBriefSchema } = await import('@/models/Schema');
    const { isNurtureSequence, readNurtureSlotsConfig } = await import('@/libs/hubspot/nurtureSlots');

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
    const sourceCfg = await contactsSourceConfig(ctx.orgId);
    const portalId = sourceCfg.portalId;
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
      // A ladder rung says so on the card: Enroll puts these sends on the
      // contact's nurture slots, which is what the sequence will send.
      fields: isNurtureSequence(input.sequenceName, readNurtureSlotsConfig(sourceCfg.nurtureSlots))
        ? [{ label: 'On Enroll', value: `${sends.length} ${sends.length === 1 ? 'send is' : 'sends are'} written to the contact's nurture slots, then the contact is enrolled` }]
        : [],
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
  // Regenerate, tiered. FAST PATH: most card feedback targets the drafted
  // content, so the workspace's mapped regenerate skill (workspace config:
  // `defaults.regenerateSkills`) runs in one scoped turn over the EXISTING
  // brief — research, lane and reviewActionRunId untouched — and the returned
  // sends save through the same validate + save + propose path, whose dedup
  // refresh re-enables the same card. FALLBACK: feedback the turn judges to
  // invalidate the research (or no mapped skill) takes the full pass — reset
  // the brief and let the subscribed automation re-research and redraft.
  // A fast-path error propagates: the regenerate route clears the in-flight
  // stamp on a rejected dispatch, so the card re-enables instead of waiting
  // out the staleness window.
  async regenerate(ctx, input, runId, feedback) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { leadBriefSchema } = await import('@/models/Schema');
    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(
        eq(leadBriefSchema.orgId, ctx.orgId),
        eq(leadBriefSchema.reviewActionRunId, runId),
      ))
      .limit(1);
    if (!lead) {
      throw new Error(`no lead brief is linked to action run ${runId} — the brief may already be regenerating`);
    }

    const { regenerateSkillFor } = await import('./regenerateSkill');
    const skillSlug = await regenerateSkillFor(ctx.orgId, 'personalization.enroll');
    let researchReason = feedback;
    if (skillSlug && lead.sections.length > 0) {
      const outcome = await regenerateSequenceCopy({ ctx, input, lead, skillSlug, feedback });
      if (outcome.done) {
        return;
      }
      // The turn judged the note research-level: fall through to the full
      // pass, carrying its reason alongside the reviewer's note.
      researchReason = outcome.reason ? `${feedback}\n\n(The redraft pass routed this to research: ${outcome.reason})` : feedback;
    }

    const { regenerateBrief } = await import('@/services/PersonalizationQueueService');
    const result = await regenerateBrief(ctx.orgId, { id: lead.id, note: researchReason });
    if (!result.regenerated) {
      throw new Error(`lead brief ${lead.id} could not be sent back for regeneration`);
    }
    // The event is what makes Regenerate immediate: the workspace's
    // regenerate-brief-on-request automation subscribes to it and briefs this
    // one lead now, rather than on the next scheduled pass — the same event
    // the brief page's Regenerate emits.
    const { emitEvent, PERSONALIZATION_BRIEF_REGENERATE_REQUESTED } = await import('@/services/EventService');
    await emitEvent({
      orgId: ctx.orgId,
      type: PERSONALIZATION_BRIEF_REGENERATE_REQUESTED,
      payload: { briefId: lead.id, contactRef: result.contactRef, contactName: result.contactName, note: researchReason },
      invokedBy: ctx.reviewedBy ?? ctx.invokedBy ?? 'review',
      // The subscribed automation runs a whole agent pass; the reviewer's
      // click must not hold the request open for it. The pass runs after the
      // response and the card advances at once.
      dispatchMode: 'background',
    });
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

    // A ladder rung sends whatever the contact's nurture slots hold, so the
    // approved sends go onto the contact FIRST, and a failed write stops the
    // enrollment: an enrolled contact with empty slots receives empty emails.
    const { isNurtureSequence, nurtureSlotProperties, readNurtureSlotsConfig, writeNurtureSlots } = await import('@/libs/hubspot/nurtureSlots');
    const slotsCfg = readNurtureSlotsConfig((await contactsSourceConfig(ctx.orgId)).nurtureSlots);
    let slotsWritten = 0;
    if (isNurtureSequence(input.sequenceName, slotsCfg)) {
      const properties = nurtureSlotProperties(input.sends, slotsCfg);
      const written = await writeNurtureSlots(client, hubspotId, properties);
      if (!written.ok) {
        throw new Error(`Not enrolled: the nurture slots could not be written to the contact (${written.message}), and "${input.sequenceName}" would send empty emails`);
      }
      slotsWritten = input.sends.length;
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
      nurtureSlotsWritten: slotsWritten,
      sendsStagedAsNote: note.ok,
      noteId: note.ok ? note.data.noteId : null,
      ...(note.ok ? {} : { noteError: note.message }),
    };
  },
};
