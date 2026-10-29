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

import type { Action, ActionContext, StaleFinding } from './types';
import type { HubspotClient } from '@/libs/hubspot/client';
import type { VoiceRules } from '@/libs/writing/voiceRules';
import { z } from 'zod';
import { voiceRulesFor } from '@/libs/writing/loadVoiceRules';
import { lintSends, outboundCopy } from '@/libs/writing/voiceRules';
import { StaleError } from './stale';

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
 * One card row per link in the sends: "Send 2 links" → the asset's title and
 * type, linked; a link the catalog does not hold says so.
 * @param orgId
 * @param sends
 */
async function linkedAssetFields(orgId: string, sends: Array<{ step: number; body: string }>): Promise<Array<{ label: string; value: string; href?: string }>> {
  const urls = sends.flatMap(s => [...s.body.replaceAll('&amp;', '&').matchAll(/https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g)].map(m => ({ step: s.step, url: m[0] })));
  if (urls.length === 0) {
    return [];
  }
  const { catalogAssets } = await import('@/services/personalization/assetCatalog');
  const { normalizeAssetUrl } = await import('@/libs/sources/assetCatalog');
  const assets = await catalogAssets(orgId).catch(() => []);
  const byUrl = new Map(assets.flatMap(a => [a.url, ...(a.aliases ?? [])].map(u => [normalizeAssetUrl(u), a] as const)));
  return urls.map(({ step, url }) => {
    const asset = byUrl.get(normalizeAssetUrl(url));
    return {
      label: `Send ${step} links`,
      value: asset ? `${asset.title} (${asset.type})` : `${url} (not in the asset catalog)`,
      href: url,
    };
  });
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
      const { listSequencesWithEmailCounts, resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
      const { DEFAULT_NURTURE_SLOTS, isNurtureSequence } = await import('@/libs/hubspot/nurtureSlots');
      const user = await resolveHubspotUserId(resolved.client, input.senderEmail);
      if (user.ok) {
        const sequences = await listSequencesWithEmailCounts(resolved.client, user.data.userId, name => isNurtureSequence(name, DEFAULT_NURTURE_SLOTS));
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
    outputInstruction: 'Fields: needsResearch (boolean); reason (string; why research is needed, or the recommendation\'s reason); sends (the FULL ordered list, each {subject, body, day?}, required unless needsResearch); recommendedSequence ({id, name, reason?}, ids exactly as the library returned them, required unless needsResearch; a Personalized Nurture rung needs exactly its emailStepCount sends); senderEmail and hubspotUserId (echo the current ones unless the library read changed them). Any "is banned" message names a phrase the sender will not have in a send: remove it and say the thing plainly, do not paraphrase it back in.',
    toolAllowlist: ['get_lead_brief', 'hubspot_list_sequences', 'find_assets'],
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

/** The live thread a contact is in, as the refusal names it. */
export type ActiveConversation = { threadId: string; subject: string; counterpart: string; lastMessageAt: string | null };

/**
 * The thread this contact is already in, from the mailbox's synced thread
 * state, or null. Fails open: a mirror or index that cannot be read lets the
 * enrolment through to the reviewer, who still decides it.
 * @param orgId - The workspace.
 * @param contactRef - The mirror ref, `contacts:<id>`.
 */
export async function activeConversationOf(orgId: string, contactRef: string): Promise<ActiveConversation | null> {
  try {
    const { contactEmailByRef } = await import('@/services/CrmRecordsService');
    const email = (await contactEmailByRef(orgId, [contactRef])).get(contactRef);
    if (!email) {
      return null;
    }
    const { activeThreadWith } = await import('@/services/mail/replyThread');
    const thread = await activeThreadWith(orgId, email);
    return thread ? { threadId: thread.threadId, subject: thread.subject, counterpart: thread.counterpart || email, lastMessageAt: thread.lastMessageAt } : null;
  } catch {
    return null;
  }
}

/**
 * What a sequence proposal for someone in a conversation is told: nothing
 * was saved, why, and the reply to propose instead, filled in.
 * @param contactName - Who.
 * @param c - The thread they are in.
 */
export function conversationRefusal(contactName: string, c: ActiveConversation): string {
  const when = c.lastMessageAt ? ` (last message ${c.lastMessageAt.slice(0, 10)})` : '';
  const subject = /^\s*re\s*:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`;
  return [
    `NOTHING WAS SAVED. ${contactName} is already in an active email thread, "${c.subject}"${when}. A sequence is for prospects who are not in a conversation.`,
    `Reply in that thread instead: propose gmail.send with { threadId: "${c.threadId}", to: "${c.counterpart}", subject: "${subject}", draft: true } and one reply as the body.`,
  ].join(' ');
}

/**
 * The HubSpot client this action writes with: the `hubspot` source's vault
 * token (a login refreshed first), else any credentialed hubspot-family source.
 * @param ctx - The action context.
 * @throws {Error} When no HubSpot credentials are connected.
 */
async function enrollClient(ctx: ActionContext): Promise<HubspotClient> {
  const { createHubspotClient } = await import('@/libs/hubspot/client');
  const { hubspotClientForOrg, hubspotTokenForActionSlug } = await import('@/services/agents/tools/hubspotDirect');
  const token = await hubspotTokenForActionSlug(ctx.orgId, 'hubspot', ctx.credentials);
  if (token) {
    return createHubspotClient({ token });
  }
  const resolved = await hubspotClientForOrg(ctx.orgId);
  if (!resolved.ok) {
    throw new Error('personalization.enroll requires connected HubSpot credentials (credentials.token)');
  }
  return resolved.client;
}

/** Lifecycle stages past the band a nurture sequence is for: someone there is a sales conversation, not a lead. */
const PAST_NURTURE_STAGES = new Set(['opportunity', 'customer', 'evangelist']);

/** What an enrollment recommendation assumed about the contact. */
type ContactBasis = {
  enrolled: boolean;
  latestSequenceId: string | null;
  lifecycleStage: string | null;
  lastReplied: string | null;
  meeting: string | null;
  lastContacted: string | null;
  optedOut: boolean;
};

const ENROLL_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * HubSpot stamps a date as ISO 8601 or epoch milliseconds.
 * @param v
 */
function hubspotTime(v: string | null | undefined): number | null {
  if (!v) {
    return null;
  }
  const t = /^\d{10,}$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function onEnrollDay(v: string | null | undefined): string {
  const t = hubspotTime(v);
  return t === null ? '' : ` on ${ENROLL_DAY.format(new Date(t))}`;
}

/**
 * The contact's state as HubSpot holds it now: enrollment, lifecycle, last
 * reply, meeting signal, last contacted, opt-out. The reply and meeting
 * properties are the workspace's own (`handoffSignals` on the contacts
 * source), the ones the handoff watcher reads.
 * @param ctx - The action context.
 * @param contactRef - `contacts:<id>`.
 * @throws {Error} When HubSpot cannot be read.
 */
async function contactState(ctx: ActionContext, contactRef: string): Promise<{ client: HubspotClient; hubspotId: string; state: ContactBasis; enrolledSince: string | null }> {
  const hubspotId = contactRef.split(':')[1];
  if (!hubspotId) {
    throw new Error(`contactRef "${contactRef}" carries no HubSpot id`);
  }
  const client = await enrollClient(ctx);
  const signals = ((await contactsSourceConfig(ctx.orgId)) as { handoffSignals?: { replyProperty?: string; meetingProperty?: string } }).handoffSignals ?? {};
  const replyProperty = signals.replyProperty || 'hs_sales_email_last_replied';
  const meetingProperty = signals.meetingProperty || 'hs_latest_meeting_activity';
  const props = ['hs_sequences_is_enrolled', 'hs_latest_sequence_enrolled', 'hs_latest_sequence_enrolled_date', 'lifecyclestage', replyProperty, meetingProperty, 'notes_last_contacted', 'hs_email_optout'];
  const res = await client.get<{ properties?: Record<string, string | null> }>(`/crm/v3/objects/contacts/${hubspotId}`, { properties: props.join(',') });
  if (!res.ok) {
    throw new Error(`HubSpot contact read failed: ${res.message}`);
  }
  const p = res.data.properties ?? {};
  return {
    client,
    hubspotId,
    enrolledSince: p.hs_latest_sequence_enrolled_date ?? null,
    state: {
      enrolled: p.hs_sequences_is_enrolled === 'true',
      latestSequenceId: p.hs_latest_sequence_enrolled ?? null,
      lifecycleStage: p.lifecyclestage ?? null,
      lastReplied: p[replyProperty] ?? null,
      meeting: p[meetingProperty] ?? null,
      lastContacted: p.notes_last_contacted ?? null,
      optedOut: p.hs_email_optout === 'true',
    },
  };
}

/**
 * "Already in sequence …": the finding both the check and the enrollment
 * itself raise, with the `code` a person's "Proceed anyway" carries back. The
 * code names the sequence, so proceeding past one never replaces another.
 * @param name - Who.
 * @param sequence - The sequence they are in.
 * @param sequence.id - Its id, when HubSpot gave one.
 * @param sequence.name - Its name, when the sender's library can see it.
 * @param since - When they were enrolled, when known.
 * @param replacing - The sequence this recommendation would enroll them in.
 */
function alreadyEnrolled(name: string, sequence: { id: string | null; name: string | null }, since: string | null, replacing: string): StaleFinding {
  const label = sequence.name ? `'${sequence.name}'` : sequence.id ? `sequence ${sequence.id}` : 'another sequence';
  return {
    line: `${name} is already in ${label}${since ? ` since${onEnrollDay(since).replace(/^ on/, '')}` : ''}. Proceeding replaces it with '${replacing}'`,
    changed: [{ label: 'Sequence', to: sequence.name ?? sequence.id ?? 'another sequence' }],
    keepOpen: true,
    code: `already_enrolled:${sequence.id ?? 'unknown'}`,
  };
}

/**
 * THE SEQUENCE A CONTACT IS IN, read one way for the check and the
 * enrollment alike, so the code a person proceeds past at the check is the
 * code the enrollment compares at execute. The id is the portal-wide
 * `hs_latest_sequence_enrolled`, else the sequence the enrollments API names
 * for the card's sender; the name is that API's, best effort (the sender's
 * library may not see a foreign enrollment).
 * @param client - HubSpot.
 * @param hubspotId - The contact.
 * @param latestSequenceId - `hs_latest_sequence_enrolled`, when HubSpot gave one.
 * @param userId - The card's sender's HubSpot user, when known.
 */
async function enrolledSequence(client: HubspotClient, hubspotId: string, latestSequenceId: string | null, userId?: string): Promise<{ id: string | null; name: string | null }> {
  const { getContactEnrollment } = await import('@/libs/hubspot/sequences');
  const detail = await getContactEnrollment(client, hubspotId, userId).catch(() => null);
  return {
    id: latestSequenceId || (detail?.ok ? detail.data.sequenceId ?? null : null),
    name: detail?.ok ? detail.data.sequenceName ?? null : null,
  };
}

export const personalizationEnrollAction: Action<typeof enrollInput> = {
  id: 'personalization.enroll',
  name: 'Enroll MQL in sequence',
  description: 'Queue multi-touch outbound: enroll a reviewed MQL who is NOT in an active email thread into the recommended existing HubSpot sequence, carrying the approved personalized sends. Anyone already in a conversation is answered with gmail.send (a reply draft in their thread), never enrolled; a proposal for one is refused with the thread to reply in.',
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
    // A PERSON IN A CONVERSATION IS ANSWERED, NOT ENROLLED. A single contact
    // with a live thread in the mailbox gets a reply in that thread; queueing
    // them into a sequence sends a cold "Step 1" to someone mid-conversation.
    // Refused here, at the one door, with the thread to reply in.
    const conversation = await activeConversationOf(ctx.orgId, input.contactRef);
    if (conversation) {
      return conversationRefusal(input.contactName, conversation);
    }
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
    // Links are the asset catalog's or nothing: a send an agent wrote may
    // link only a URL the catalog holds, so a made-up or mistyped page never
    // reaches a reviewer. Carried sends are judged the same way voice is.
    const { linksOutsideCatalog } = await import('@/services/personalization/assetCatalog');
    const outside = await linksOutsideCatalog(ctx.orgId, input.sends.filter((_, i) => !unchanged.has(i)).map(s => s.body));
    if (outside.length > 0) {
      return [
        `NOTHING WAS SAVED. ${outside.length} link(s) in the drafted sends are not in the asset catalog:`,
        ...outside.map(u => `- ${u}`),
        'Link only a url find_assets returned, written exactly as returned, or leave the link out.',
      ].join('\n');
    }
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
  // What the recommendation assumed about the contact when it was drafted.
  async basisFor(ctx, input) {
    const { state } = await contactState(ctx, input.contactRef);
    return state as unknown as Record<string, unknown>;
  },
  // Stale when the lead moved on in the days it waited: unsubscribed, replied,
  // booked a meeting, advanced past the nurture band, was contacted, or is
  // now in an email thread (each closed by the sweep with the line); or is
  // already in a sequence (kept open: replacing it is the person's call).
  async stillHolds(ctx, input, basis) {
    const was = basis as ContactBasis | null;
    const since = ctx.proposedAt?.getTime() ?? Date.now();
    const { client, hubspotId, state, enrolledSince } = await contactState(ctx, input.contactRef);
    const name = input.contactName;
    const after = (v: string | null) => {
      const t = hubspotTime(v);
      return t !== null && t > since;
    };
    if (state.optedOut && !was?.optedOut) {
      return { line: `${name} unsubscribed from email since this was proposed` };
    }
    if (after(state.lastReplied)) {
      return { line: `${name} replied${onEnrollDay(state.lastReplied)}, after this was proposed` };
    }
    // A meeting is news when the signal CHANGED since the basis: HubSpot's
    // timestamp is the meeting's own date (often in the future), so it is
    // compared with what the basis held, never with when this was proposed.
    // With no basis there is nothing to compare, and nothing is claimed.
    const { readMeetingSignal } = await import('@/services/HandoffTriggerService');
    const meeting = readMeetingSignal(state.meeting);
    const wasMeeting = readMeetingSignal(was?.meeting ?? null);
    const booked = !was
      ? false
      : meeting.kind === 'time'
        ? meeting.at !== null && (wasMeeting.kind !== 'time' || wasMeeting.at === null || wasMeeting.at.getTime() !== meeting.at.getTime())
        : meeting.set && !(wasMeeting.kind === 'flag' && wasMeeting.set);
    if (booked) {
      return { line: `${name} booked a meeting since this was proposed${meeting.kind === 'time' ? ` (meeting${onEnrollDay(meeting.at!.toISOString())})` : ''}` };
    }
    if (state.lifecycleStage && PAST_NURTURE_STAGES.has(state.lifecycleStage) && state.lifecycleStage !== was?.lifecycleStage) {
      return {
        line: `${name}'s lifecycle stage moved from ${was?.lifecycleStage ?? 'unknown'} to ${state.lifecycleStage} since this was proposed`,
        changed: [{ label: 'Lifecycle stage', ...(was?.lifecycleStage ? { from: was.lifecycleStage } : {}), to: state.lifecycleStage }],
      };
    }
    if (state.enrolled) {
      return alreadyEnrolled(name, await enrolledSequence(client, hubspotId, state.latestSequenceId, input.hubspotUserId), enrolledSince, input.sequenceName);
    }
    if (after(state.lastContacted)) {
      return { line: `${name} was contacted${onEnrollDay(state.lastContacted)}, after this was proposed (HubSpot's last contacted)` };
    }
    const conversation = await activeConversationOf(ctx.orgId, input.contactRef);
    if (conversation?.lastMessageAt && Date.parse(conversation.lastMessageAt) > since) {
      return { line: `${name} is now in an email thread, "${conversation.subject}"${onEnrollDay(conversation.lastMessageAt)}; answer it there rather than enroll` };
    }
    return null;
  },
  // One queue item per contact: a re-fired sweep updates the pending item in
  // place, never duplicates it.
  dedupKeyFor: input => `personalization.enroll:${input.contactRef}`,
  // The contact it enrolls; the sequence and the sender are only named.
  subjectRefs: input => [input.contactRef],
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
    const provenance: Array<{ label: string; value: string; handle?: boolean }> = [];
    if (lead?.entranceSource) {
      provenance.push({ label: 'Source', value: entranceLabel(lead.entranceSource) });
    }
    // An ad platform passes its campaign and ad ids as the UTM values when it
    // passes no name: a bare number is that id, marked so the shell does not
    // show digits as a campaign name. A named campaign shows.
    const adId = (v: string) => /^\d{6,}$/.test(v.trim());
    if (lead?.utmCampaign) {
      provenance.push({ label: 'Campaign', value: lead.utmCampaign, ...(adId(lead.utmCampaign) ? { handle: true } : {}) });
    }
    // The ad lead magnet they answered, from the CRM mirror (the ledger row
    // does not carry it; see `contactUtmContentByRef`).
    const { contactUtmContentByRef } = await import('@/services/CrmRecordsService');
    const utmContent = (await contactUtmContentByRef(ctx.orgId, [input.contactRef]).catch(() => new Map<string, string>())).get(input.contactRef);
    if (utmContent) {
      provenance.push({ label: 'Lead magnet', value: utmContent, ...(adId(utmContent) ? { handle: true } : {}) });
    }
    // Who the emails go out as, and from which inbox if it were enrolled
    // now: the platform picks the inbox at Enroll (warm-up ramps first), so
    // the card shows today's pick and its standing against the day's budget.
    const { senderConfigOf } = await import('@/libs/hubspot/senderInboxes');
    const senderCfg = senderConfigOf(sourceCfg);
    let effectiveSender = input.senderEmail;
    if (senderCfg) {
      const { pickInboxNow } = await import('@/services/personalization/senderLedger');
      const pick = await pickInboxNow(ctx.orgId, senderCfg, input.contactRef).catch(() => null);
      if (pick?.ok) {
        effectiveSender = pick.inbox.email;
        const standing = pick.capToday === null
          ? null
          : `${pick.week ? `warm-up week ${pick.week} · ` : ''}${pick.usedToday} of ${pick.capToday} sent today`;
        provenance.push({ label: 'Sends from', value: standing ? `${pick.inbox.email} (${standing})` : pick.inbox.email });
      } else {
        effectiveSender = senderCfg.user;
        provenance.push({ label: 'Sends from', value: pick ? pick.message : `${senderCfg.user}'s inboxes` });
      }
    } else {
      provenance.push({ label: 'Sender', value: input.senderEmail });
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
      // The steps, as a timeline: "Step 1 · Day 0 · email". Each one is
      // still its own editable item, so the walk and regenerate are as they were.
      sequence: { name: input.sequenceName, contact: input.contactName, sender: effectiveSender, system: 'HubSpot' },
      content: sends.map(s => ({
        kind: 'email' as const,
        id: `send-${s.step}`,
        label: s.day !== undefined ? `Day ${s.day}` : `Step ${s.step}`,
        tabLabel: [`Step ${s.step}`, s.day !== undefined ? `Day ${s.day}` : null, 'email'].filter(Boolean).join(' · '),
        subject: s.subject,
        body: s.body,
      })),
      // A ladder rung says so on the card: Enroll puts these sends on the
      // contact's nurture slots, which is what the sequence will send.
      fields: [
        ...(isNurtureSequence(input.sequenceName, readNurtureSlotsConfig(sourceCfg.nurtureSlots))
          ? [{ label: 'On Enroll', value: `${sends.length} ${sends.length === 1 ? 'send is' : 'sends are'} written to the contact's nurture slots, then the contact is enrolled` }]
          : []),
        // What each send links, named from the asset catalog, so the
        // reviewer sees the asset without reading the URL.
        ...(await linkedAssetFields(ctx.orgId, sends)),
      ],
      // The lead's own page — the card and the research land on one URL.
      links: [{ label: 'View Research', href: hubspotId ? `/gtm/lead/${hubspotId}` : '/gtm/personalization' }],
      verbs: { approve: 'Queue in HubSpot', reject: 'Decline' },
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
    const { createHubspotClient } = await import('@/libs/hubspot/client');
    const { hubspotTokenForActionSlug } = await import('@/services/agents/tools/hubspotDirect');
    const hubspotId = input.contactRef.split(':')[1];
    if (!hubspotId) {
      throw new Error(`contactRef "${input.contactRef}" carries no HubSpot id`);
    }
    // The `hubspot` source's vault token, or any credentialed hubspot-family
    // source (the workspace splits contacts/deals/companies into slugs).
    // A login's 30-minute token is refreshed first and saved to the source row.
    const token = await hubspotTokenForActionSlug(ctx.orgId, 'hubspot', ctx.credentials);
    let client = token ? createHubspotClient({ token }) : null;
    if (!client) {
      const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
      const resolved = await hubspotClientForOrg(ctx.orgId);
      if (!resolved.ok) {
        throw new Error('personalization.enroll requires connected HubSpot credentials (credentials.token)');
      }
      client = resolved.client;
    }

    // The sender is workspace config when the workspace names one: a user
    // plus the inboxes Enroll may send from. The inbox is picked here, from
    // today's counts on the server clock (warm-up ramps fill first, a lead
    // keeps the inbox it heard from before), and the enrollment runs as the
    // HubSpot user the inbox is connected under. A redraft can read another
    // user's library, and on 2026-09-25 that enrolled contacts as the founder,
    // so the card's sender never decides. A configured user the portal cannot
    // resolve stops the enrollment rather than falling back to the card's.
    const sourceCfg = await contactsSourceConfig(ctx.orgId);
    const { senderConfigOf } = await import('@/libs/hubspot/senderInboxes');
    const senderCfg = senderConfigOf(sourceCfg);
    let senderEmail = input.senderEmail;
    let hubspotUserId = input.hubspotUserId;
    let inboxPick: { reason: string; usedToday: number; capToday: number | null; week: number | null } | null = null;
    let relay: { senderUser: string; senderOwnerId: string; relayUserId: string; relayOwnerId: string; ownerBefore: string | null } | null = null;
    if (senderCfg) {
      const { pickInboxNow } = await import('@/services/personalization/senderLedger');
      const pick = await pickInboxNow(ctx.orgId, senderCfg, input.contactRef);
      if (!pick.ok) {
        throw new Error(`Not enrolled: ${pick.message}`);
      }
      const { resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
      const user = await resolveHubspotUserId(client, pick.hubspotUser);
      if (!user.ok) {
        throw new Error(`Not enrolled: ${pick.hubspotUser}, the HubSpot user ${pick.inbox.email} sends as, could not be resolved on the portal (${user.message}), and the card's sender ${input.senderEmail} is not used in its place`);
      }
      senderEmail = pick.inbox.email;
      hubspotUserId = user.data.userId;
      inboxPick = { reason: pick.reason, usedToday: pick.usedToday, capToday: pick.capToday, week: pick.week };
      if (pick.hubspotUser.toLowerCase() !== senderCfg.user.toLowerCase()) {
        // The inbox is connected under someone else's user. HubSpot makes that
        // user the owner of the sequence's tasks and of an unowned contact;
        // the result records who should own them so the contacts sync can
        // hand them back (`relayOwnership.ts`).
        const owner = await resolveHubspotUserId(client, senderCfg.user);
        if (!owner.ok) {
          throw new Error(`Not enrolled: the sender ${senderCfg.user} could not be resolved on the portal (${owner.message})`);
        }
        const before = await client.get<{ properties?: { hubspot_owner_id?: string | null } }>(`/crm/v3/objects/contacts/${hubspotId}`, { properties: 'hubspot_owner_id' });
        relay = {
          senderUser: senderCfg.user,
          senderOwnerId: owner.data.ownerId,
          relayUserId: user.data.userId,
          relayOwnerId: user.data.ownerId,
          ownerBefore: before.ok ? before.data.properties?.hubspot_owner_id || null : null,
        };
      }
    }

    // HubSpot allows ONE active sequence per contact, and the portal's own
    // automations race this review flow (observed 2026-09-14: a workflow
    // auto-enrolled the lead hours before the human approved, and the approved
    // enrollment bounced with CONTACT_ALREADY_ENROLLED). Replacing it was once
    // silent for every decider; it risked a double sequence on a lead who had
    // moved on in the days the card waited. Now:
    //   - a person's own word runs: it replaces, and the run says what it
    //     replaced in one line (`result.advice`);
    //   - a person approving the card replaces only after they were told which
    //     sequence it is and proceeded anyway (`ctx.proceededPast`, carrying
    //     this sequence's code);
    //   - anything else (an agent, the ladder, a clock) goes back to Review
    //     with the line (`StaleError`), never failed.
    const { readSequenceEnrollmentState, requestUnenroll } = await import('@/libs/hubspot/unenrollBridge');
    let replacedSequence: { sequenceId: string | null; sequenceName: string | null } | null = null;
    let advice: string | null = null;
    const enrollmentState = await readSequenceEnrollmentState(client, hubspotId);
    if (enrollmentState.ok && enrollmentState.data.enrolled) {
      // The same reading the check made, so the codes agree.
      const current = await enrolledSequence(client, hubspotId, enrollmentState.data.latestSequenceId, input.hubspotUserId);
      replacedSequence = { sequenceId: current.id, sequenceName: current.name };
      const finding = alreadyEnrolled(input.contactName, current, null, input.sequenceName);
      if (ctx.onPersonsWord) {
        advice = `${input.contactName} was already in ${current.name ? `'${current.name}'` : current.id ? `sequence ${current.id}` : 'another sequence'}; it was replaced with '${input.sequenceName}'.`;
      } else if (ctx.proceededPast?.code !== finding.code) {
        throw new StaleError(finding);
      }
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
      // Each email in the rung sends one slot; a draft short of the rung's
      // email count sends an empty email (2026-10-16), so the count is checked
      // against the live sequence before anything is written.
      const { getSequence } = await import('@/libs/hubspot/sequences');
      const { rungSendCountProblem } = await import('@/libs/hubspot/nurtureSlots');
      const rung = await getSequence(client, input.sequenceId, hubspotUserId ?? '');
      if (!rung.ok) {
        throw new Error(`Not enrolled: "${input.sequenceName}" could not be read to check its email count (${rung.message})`);
      }
      const countProblem = rungSendCountProblem(rung.data, input.sends.length, slotsCfg);
      if (countProblem) {
        throw new Error(`Not enrolled: ${countProblem}. Regenerate the draft for this rung, or recommend the rung that matches it.`);
      }
      const { linkRewriterFor } = await import('@/services/personalization/assetCatalog');
      const rewriteHref = await linkRewriterFor(ctx.orgId);
      const properties = nurtureSlotProperties(input.sends, slotsCfg, new Date(), { rewriteHref });
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
      // Why that inbox, and where it stood today before this enrollment.
      inbox: inboxPick,
      // Set when the inbox runs as another HubSpot user: who should own what HubSpot assigns them.
      relay,
      // The sender the card carried, when the workspace's own won over it.
      cardSenderEmail: senderEmail.toLowerCase() === input.senderEmail.toLowerCase() ? null : input.senderEmail,
      sendCount: input.sends.length,
      nurtureSlotsWritten: slotsWritten,
      sendsStagedAsNote: note.ok,
      noteId: note.ok ? note.data.noteId : null,
      ...(note.ok ? {} : { noteError: note.message }),
      // The sequence this reviewed enrollment displaced, when there was one.
      replacedSequence,
      // On a person's own word: what it found and did, in one line to tell them.
      ...(advice ? { advice } : {}),
    };
  },
};
