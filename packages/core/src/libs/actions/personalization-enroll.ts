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
 *
 * Voice is gated structurally, at both doors. `precheck` lints every send
 * against the workspace's voice rules before a proposal is accepted, so no
 * path into the queue can carry a banned construction — not the hourly
 * drafting pass, not Regenerate, not an API caller, not a replay. The
 * regenerate fast path additionally wraps its skill-turn output schema in the
 * same rules, so the model is told the offending phrase and the reason and
 * gets exactly one corrective retry before the turn fails loudly.
 */

import type { Action } from './types';
import type { VoiceRules } from '@/libs/writing/voiceRules';
import { z } from 'zod';
import { voiceRulesFor } from '@/libs/writing/loadVoiceRules';
import { lintSends, outboundCopy } from '@/libs/writing/voiceRules';

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
async function contactsSourceConfig(orgId: string): Promise<{ portalId?: string | number; nurtureSlots?: unknown; defaultSender?: string }> {
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
  return (source?.configJson as { portalId?: string | number; nurtureSlots?: unknown; defaultSender?: string } | null) ?? {};
}

/**
 * What the scoped regenerate turn must answer with: either the full new draft
 * (every send, edited or not, plus the recommendation) or a routing to the
 * research fallback. Writes stay impossible structurally — the turn returns
 * data and the SERVER saves it through the same validate + save + propose
 * path as the hourly pass.
 */
/**
 * The regenerate turn's answer shape, built per-org because the voice rules
 * are workspace config. Wrapping `subject` and `body` in `outboundCopy` turns
 * the voice from an instruction the model may drift from into a validation
 * contract `runSkillTurn` enforces: a banned phrase becomes a zod issue, the
 * issue text names the phrase and the reason, and `runSkillTurn` hands that
 * straight back to the model as its one corrective retry.
 * @param rules - The merged workspace voice rules.
 */
function regenerateTurnOutputFor(rules: VoiceRules) {
  return z.object({
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
      subject: outboundCopy(rules, 'subject').min(1),
      body: outboundCopy(rules, 'body').min(1),
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
}

/**
 * What the SCOPED turn must answer with: one send, because the instruction
 * was about one send.
 *
 * Not "the full list, and please only change send 4". The turn was asked
 * exactly that in prose — *"rewrite what the note asks and keep the rest"* —
 * and rewrote all four anyway (Chris, 2026-09-20: *"I approved emails 1-3 and
 * then regenerated the 4th one and it regenerated all emails"*). A shape that
 * cannot carry the other sends is what makes that impossible rather than
 * discouraged, which is this repo's rule for a behaviour that is a
 * requirement: prompt once, then enforce it structurally. The server keeps
 * every other send from the input it already holds.
 * @param rules - The merged workspace voice rules.
 */
function scopedRegenerateTurnOutputFor(rules: VoiceRules) {
  return z.object({
    /** True when the note invalidates the research itself — the full pass takes over. */
    needsResearch: z.boolean(),
    /** Why it needs research, or a short note on what changed. */
    reason: z.string().nullish(),
    send: z.object({
      subject: outboundCopy(rules, 'subject').min(1),
      body: outboundCopy(rules, 'body').min(1),
    }).nullish(),
  }).superRefine((v, sctx) => {
    if (!v.needsResearch && !v.send) {
      sctx.addIssue({ code: z.ZodIssueCode.custom, message: 'send is required (the one named in the task) unless needsResearch is true' });
    }
  });
}

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
 * @param opts.contentId - The one send the instruction was typed beside, if any.
 */
async function regenerateSequenceCopy(opts: {
  ctx: { orgId: string; invokedBy?: string; reviewedBy?: string };
  input: z.infer<typeof enrollInput>;
  lead: typeof import('@/models/Schema').leadBriefSchema.$inferSelect;
  skillSlug: string;
  feedback: string;
  contentId?: string;
}): Promise<FastRegenerateOutcome> {
  const { ctx, input, lead, skillSlug, feedback } = opts;
  const { logger } = await import('@/libs/Logger');

  // Which send the reviewer typed the instruction beside. `send-<step>` is the
  // id the presenter gives each item, and `applyContentEdits` reads the same
  // one, so the two paths that act on a single send agree on what names it.
  const step = Number(/^send-(\d+)$/.exec(opts.contentId ?? '')?.[1]);
  const target = Number.isInteger(step) ? input.sends.find(s => s.step === step) : undefined;

  // ── One send: rewrite that one, keep the rest verbatim ──────────────────
  //
  // Everything outside the named send comes from the input we already hold,
  // so a scoped regenerate CANNOT disturb another send's copy — and therefore
  // cannot clear a check a reviewer earned on it, since a check is a hash of
  // exactly that copy. The sequence, the sender and the recommendation are
  // left alone for the same reason: the instruction was typed into a box that
  // asks what one email should do differently.
  //
  // No library pre-read and no `hubspot_list_sequences` here either. The
  // sequence cannot change on this turn, so reading it would be a HubSpot
  // round trip whose answer has nowhere to land.
  if (target) {
    const label = target.day !== undefined ? `Day ${target.day}` : `Send ${target.step}`;
    const voiceRules = await voiceRulesFor(ctx.orgId);
    const { runSkillTurn } = await import('@/services/agents/skillTurn');
    const { output, toolCalls, durationMs } = await runSkillTurn({
      orgId: ctx.orgId,
      skillSlug,
      userId: ctx.reviewedBy,
      task: [
        `A reviewer pressed Regenerate on ONE send of the enroll card for ${input.contactName} (${input.contactRef}).`,
        `The send is step ${target.step} (${label}). Their instruction is:`,
        `"${feedback}"`,
        'Rewrite that send, and answer with that send alone. The others keep exactly what they have — a reviewer may already have approved them — so write this one to sit correctly beside them. Answer needsResearch when the note falls outside what rewriting one send can fix.',
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
          title: `The send to rewrite (step ${target.step}, ${label})`,
          body: JSON.stringify({ step: target.step, day: target.day, subject: target.subject, body: target.body }, null, 2),
        },
        {
          title: 'The rest of the sequence, for continuity (NOT yours to change on this turn)',
          body: JSON.stringify({
            sequenceName: input.sequenceName,
            sends: input.sends.filter(x => x.step !== target.step),
          }, null, 2),
        },
      ],
      outputSchema: scopedRegenerateTurnOutputFor(voiceRules),
      outputInstruction: 'Fields: needsResearch (boolean); reason (string; why research is needed, or a short note on what you changed); send ({subject, body} for the ONE send named in the task, required unless needsResearch). Any "is banned" message names a phrase the sender will not have in a send: remove it and say the thing plainly, do not paraphrase it back in.',
      toolAllowlist: ['get_lead_brief'],
      maxAnswerRetries: 1,
    });

    if (output.needsResearch) {
      logger.info('scoped regenerate routed to research', { orgId: ctx.orgId, contactRef: input.contactRef, step: target.step, reason: output.reason, durationMs });
      return { done: false, reason: output.reason ?? undefined };
    }

    const { saveDraftSequence } = await import('@/services/PersonalizationQueueService');
    const saved = await saveDraftSequence(ctx.orgId, {
      // Order preserved, because `saveDraftSequence` assigns each step from
      // its position. Only the named one carries new copy.
      sends: input.sends.map(x => ({
        subject: x.step === target.step ? output.send!.subject : x.subject,
        body: x.step === target.step ? output.send!.body : x.body,
        ...(x.day != null ? { day: x.day } : {}),
      })),
      contactRef: input.contactRef,
      recommendedSequence: {
        id: input.sequenceId,
        name: input.sequenceName,
        ...(lead.recommendedSequence?.reason != null ? { reason: lead.recommendedSequence.reason } : {}),
      },
      senderEmail: input.senderEmail,
      hubspotUserId: input.hubspotUserId,
    });
    if (!saved.saved) {
      throw new Error(`scoped regenerate could not save the redraft: ${saved.message ?? saved.reason ?? 'unknown'}`);
    }
    logger.info('scoped regenerate landed', {
      orgId: ctx.orgId,
      contactRef: input.contactRef,
      step: target.step,
      reviewRunId: saved.reviewRunId,
      sendCount: saved.sendCount,
      toolCalls,
      durationMs,
    });
    return { done: true };
  }

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

  // The workspace's voice, as a validation contract rather than a hope.
  const voiceRules = await voiceRulesFor(ctx.orgId);

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
    outputSchema: regenerateTurnOutputFor(voiceRules),
    outputInstruction: 'Fields: needsResearch (boolean); reason (string; why research is needed, or the recommendation\'s reason); sends (the FULL ordered list, each {subject, body, day?}, required unless needsResearch); recommendedSequence ({id, name, reason?}, ids exactly as the library returned them, required unless needsResearch); senderEmail and hubspotUserId (echo the current ones unless the library read changed them). Any "is banned" message names a phrase the sender will not have in a send: remove it and say the thing plainly, do not paraphrase it back in.',
    toolAllowlist: ['get_lead_brief', 'hubspot_list_sequences'],
    // One corrective retry, then fail. A model that repeats a banned phrase
    // after being told the phrase and the reason will not find it on the
    // fourth attempt, and a loud failure is the whole point: a draft carrying
    // the phrase must never land in the queue.
    maxAnswerRetries: 1,
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

/**
 * Which positions of `input.sends` are already on this contact's pending (or
 * failed) card with the same subject and body. Those sends were not written by
 * whoever is proposing now; they are being carried. Empty when there is no
 * such card, which is the brand-new-proposal case.
 * @param orgId
 * @param input - The sends being proposed, in order.
 */
async function unchangedSends(orgId: string, input: z.infer<typeof enrollInput>): Promise<Set<number>> {
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const [existing] = await db
    .select({ input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'personalization.enroll'),
      eq(actionRunSchema.dedupKey, `personalization.enroll:${input.contactRef}`),
      inArray(actionRunSchema.status, ['pending', 'failed']),
    ))
    .limit(1);
  const prior = (existing?.input as { sends?: Array<{ subject?: string; body?: string }> } | undefined)?.sends ?? [];
  const out = new Set<number>();
  input.sends.forEach((send, i) => {
    const was = prior[i];
    if (was && was.subject === send.subject && was.body === send.body) {
      out.add(i);
    }
  });
  return out;
}

export const personalizationEnrollAction: Action<typeof enrollInput> = {
  id: 'personalization.enroll',
  name: 'Enroll MQL in sequence',
  description: 'Enroll a reviewed MQL into the recommended existing HubSpot sequence, carrying the approved personalized sends.',
  inputSchema: enrollInput,
  grant: 'enroll_lead',
  external: true,

  /**
   * The voice gate, at the one door every proposal has to pass through.
   *
   * `runSkillTurn`'s schema catches the regenerate path, but that is one of
   * several ways sends reach this action — the hourly drafting pass proposes
   * through `saveDraftSequence`, the write API proposes directly, a replay
   * re-proposes stored input. A gate that only covers the model call is a
   * gate with a corridor around it. `precheck` runs inside `proposeAction`,
   * after schema validation and before any write, so there is no path into
   * the review queue that skips it.
   *
   * The refusal names every offending span and its authored reason, because
   * whoever receives it — an agent mid-pass, an API caller, a person reading
   * a log — has to be able to fix it without guessing which words were wrong.
   * @param ctx
   * @param input
   */
  async precheck(ctx, input) {
    const rules = await voiceRulesFor(ctx.orgId);
    // Only the sends that CHANGED are judged. A scoped regenerate rewrites one
    // send and, by design, keeps the others word for word so a reviewer's
    // approvals on them survive; it then re-proposes the whole sequence. A
    // card drafted before the gate existed carries em dashes in the sends
    // nobody touched, so judging all of them refused the clean send for its
    // neighbours' sake, every time, and the reviewer could fix nothing
    // (ticket 069, proposal 509, 2026-09-22). A send identical to what is
    // already on the pending card was already on the card; refusing it now
    // removes nothing. A brand-new card has no pending run, so every send is
    // new and every send is judged: nothing with a dash gets IN through here.
    const unchanged = await unchangedSends(ctx.orgId, input);
    const { ok, report, count } = lintSends(input.sends.map((s, i) => ({ ...s, step: s.step ?? i + 1 })).filter((_, i) => !unchanged.has(i)), rules);
    if (ok) {
      return;
    }
    return [
      `NOTHING WAS SAVED. ${count} voice-rule violation(s) in the drafted sends.`,
      'These are the workspace\'s versioned voice rules (workspace/<org>/voice.yaml plus the platform floor), not a style suggestion:',
      report,
      'Rewrite the offending sends without those constructions and propose again. Do not paraphrase a banned phrase back in.',
    ].join('\n');
  },

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
    // The ad lead magnet they answered, from the CRM mirror (the ledger row
    // does not carry it; see `contactUtmContentByRef`).
    const { contactUtmContentByRef } = await import('@/services/CrmRecordsService');
    const utmContent = (await contactUtmContentByRef(ctx.orgId, [input.contactRef]).catch(() => new Map<string, string>())).get(input.contactRef);
    if (utmContent) {
      provenance.push({ label: 'Lead magnet', value: utmContent });
    }
    // Who the emails go out as. The workspace's configured sender wins over
    // whatever the card carries, and the card says so when they differ.
    const effectiveSender = sourceCfg.defaultSender ?? input.senderEmail;
    provenance.push({
      label: 'Sender',
      value: sourceCfg.defaultSender && sourceCfg.defaultSender.toLowerCase() !== input.senderEmail.toLowerCase()
        ? `${sourceCfg.defaultSender} (the card named ${input.senderEmail})`
        : effectiveSender,
    });
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
  async regenerate(ctx, input, runId, feedback, opts) {
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
      const outcome = await regenerateSequenceCopy({ ctx, input, lead, skillSlug, feedback, ...(opts?.contentId ? { contentId: opts.contentId } : {}) });
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
      // INLINE, deliberately. This handler already runs behind the response
      // (the regenerate route dispatches it via `after`), so holding for the
      // agent pass costs the reviewer nothing — and 'background' here would
      // register a NESTED `after` inside an `after` callback, which Next
      // silently drops: observed on prod 2026-09-14, fire row created, pass
      // never ran. Callers that emit this event during a live request (the
      // brief page's regenerate route) keep 'background'.
      dispatchMode: 'inline',
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

    // The sender is workspace config when the workspace names one. The card
    // still carries a sender (the library the draft read), but a redraft can
    // read another user's library, and on 2026-09-25 that enrolled contacts
    // as the founder with his inbox sending and his name on every task. A
    // configured sender the portal cannot resolve stops the enrollment
    // rather than falling back to the card's.
    const sourceCfg = await contactsSourceConfig(ctx.orgId);
    let senderEmail = input.senderEmail;
    let hubspotUserId = input.hubspotUserId;
    if (sourceCfg.defaultSender && sourceCfg.defaultSender.toLowerCase() !== input.senderEmail.toLowerCase()) {
      const { resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
      const user = await resolveHubspotUserId(client, sourceCfg.defaultSender);
      if (!user.ok) {
        throw new Error(`Not enrolled: the workspace's sender ${sourceCfg.defaultSender} could not be resolved on the portal (${user.message}), and the card's sender ${input.senderEmail} is not used in its place`);
      }
      senderEmail = sourceCfg.defaultSender;
      hubspotUserId = user.data.userId;
    }

    // HubSpot allows ONE active sequence per contact, and the portal's own
    // automations race this review flow (observed 2026-09-14: a workflow
    // auto-enrolled the lead hours before the human approved, and the approved
    // enrollment bounced with CONTACT_ALREADY_ENROLLED). The reviewed
    // enrollment wins: unenroll first via the workflow bridge, then enroll.
    const { readSequenceEnrollmentState, requestUnenroll } = await import('@/libs/hubspot/unenrollBridge');
    let replacedSequence: { sequenceId: string | null; sequenceName: string | null } | null = null;
    const enrollmentState = await readSequenceEnrollmentState(client, hubspotId);
    if (enrollmentState.ok && enrollmentState.data.enrolled) {
      // Best-effort detail for the result; the sender's library may not see a
      // foreign enrollment, and the replace proceeds either way.
      const { getContactEnrollment } = await import('@/libs/hubspot/sequences');
      const detail = await getContactEnrollment(client, hubspotId, hubspotUserId);
      replacedSequence = {
        sequenceId: (detail.ok && detail.data.sequenceId) || enrollmentState.data.latestSequenceId,
        sequenceName: detail.ok ? detail.data.sequenceName ?? null : null,
      };
      const unenrolled = await requestUnenroll(client, { contactId: hubspotId });
      if (!unenrolled.ok) {
        throw new Error(`Not enrolled: the contact is already in ${replacedSequence.sequenceName ?? `sequence ${replacedSequence.sequenceId ?? '(unknown)'}`} and the unenroll did not complete — ${unenrolled.message}`);
      }
    }

    // A ladder rung sends whatever the contact's nurture slots hold, so the
    // approved sends go onto the contact FIRST, and a failed write stops the
    // enrollment: an enrolled contact with empty slots receives empty emails.
    const { ensureNurtureSlotProperties, isNurtureSequence, nurtureSlotProperties, readNurtureSlotsConfig, writeNurtureSlots } = await import('@/libs/hubspot/nurtureSlots');
    const slotsCfg = readNurtureSlotsConfig(sourceCfg.nurtureSlots);
    let slotsWritten = 0;
    if (isNurtureSequence(input.sequenceName, slotsCfg)) {
      const properties = nurtureSlotProperties(input.sends, slotsCfg);
      // The portal may not have a property for every slot yet (a fifth rung
      // email, a new portal). Provision what is missing before the write, so
      // raising `maxSlots` in the workspace is the whole platform-side change.
      const ensured = await ensureNurtureSlotProperties(client, slotsCfg, input.sends.length);
      if (!ensured.ok) {
        throw new Error(`Not enrolled: the nurture slot properties could not be checked or created on the portal (${ensured.message})`);
      }
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
      senderEmail,
      userId: hubspotUserId,
    });
    if (!enrolled.ok) {
      throw new Error(`HubSpot sequence enrollment failed: ${enrolled.message}`);
    }

    // The sequences API cannot carry per-enrollment copy, so the APPROVED
    // sends are staged for the sender on the contact's timeline. Non-fatal:
    // the enrollment already happened, and the result says which occurred.
    // hs_note_body renders as HTML too, and each body is converted on its own
    // rather than after being joined: a reviewer's formatted send is already
    // HTML, and escaping the whole joined string would show them its tags.
    const { emailBodyHtml } = await import('@/libs/writing/emailBody');
    const esc = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const noteBody = [
      `<p>Approved personalized sends for "${esc(input.sequenceName)}" (reviewed in Vocion):</p>`,
      ...input.sends.map(s => `<p><strong>Send ${s.step}${s.day !== undefined ? ` · Day ${s.day}` : ''}</strong><br>Subject: ${esc(s.subject)}</p>${emailBodyHtml(s.body)}`),
    ].join('<hr>');
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
      senderEmail,
      // The sender the card carried, when the workspace's own won over it.
      cardSenderEmail: senderEmail.toLowerCase() === input.senderEmail.toLowerCase() ? null : input.senderEmail,
      sendCount: input.sends.length,
      nurtureSlotsWritten: slotsWritten,
      sendsStagedAsNote: note.ok,
      noteId: note.ok ? note.data.noteId : null,
      ...(note.ok ? {} : { noteError: note.message }),
      // The sequence this reviewed enrollment displaced, when there was one.
      replacedSequence,
    };
  },
};
