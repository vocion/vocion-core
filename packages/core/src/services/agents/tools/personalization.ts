/**
 * Personalization-lane tools — new MQLs become queue rows, each one is
 * researched into a brief, and each briefed lead is drafted into numbered
 * sends recommending an EXISTING HubSpot sequence. Nothing is ever sent
 * here: `save_draft_sequence` proposes the `personalization.enroll` review
 * item server-side, and only a human's Enroll executes it.
 *
 * The guarantees are STRUCTURAL, the same way the discovery lane's are:
 *
 *   - `queue_lead` takes CRM mirror refs and re-reads those records itself,
 *     so the agent supplies WHICH leads and never WHAT is recorded about
 *     them. A queued row cannot carry research that never ran.
 *   - The unique index on (orgId, contactRef) is the de-duplication. There is
 *     no de-dup logic to get wrong; a re-fire inserts nothing.
 *   - `save_lead_brief` writes the brief and nothing else. Identity, entrance
 *     source and the engagement counters are not arguments, so a re-run can
 *     never change who the lead is however the model describes them.
 *   - `next_lead_to_brief` counts the try in the act of handing out the work,
 *     so the three-try budget holds even when a run dies silently.
 *     `next_brief_to_draft` makes the same contract for the drafting phase.
 *   - `save_draft_sequence` proposes the review item ITSELF, in the same
 *     operation that writes the drafts — the agent cannot forget to surface
 *     the lead, and the recommendation is verified against the live
 *     sequence library so an invented sequence is refused.
 *   - These tools are GRANTED, not default: they build only for agents whose
 *     `harness.grantTools` names them.
 *
 * `web_search`, `fetch_url`, `crawl_site` and `search_knowledge` are NOT here.
 * They reach every agent through `buildDomainTools` and are not grant-gated.
 *
 * Registered via `personalizationTools(ctx)` in `./registry.ts`.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { resolvedModelId } from '@/libs/llm';
import {
  claimBriefToDraft,
  claimLeadToBrief,
  leadLedger,
  MAX_BRIEF_ATTEMPTS,
  MAX_DRAFT_ATTEMPTS,
  queueLeads,
  reconcileMqlWindow,
  recordBriefFailure,
  recordDraftFailure,
  saveDraftSequence,
  saveHandoffBrief,
  saveLeadBrief,
  UnknownStageError,
} from '@/services/PersonalizationQueueService';
import { hubspotClientForCtx } from './hubspotDirect';

/** Tool names that exist only for agents granted them via `harness.grantTools`. */
export const PERSONALIZATION_TOOL_NAMES = [
  'queue_lead',
  'get_lead_ledger',
  'reconcile_mql_window',
  'next_lead_to_brief',
  'save_lead_brief',
  'save_handoff_brief',
  'record_brief_failure',
  'next_brief_to_draft',
  'save_draft_sequence',
  'record_draft_failure',
  'hubspot_list_sequences',
] as const;

const WINDOW_CAVEAT = 'The window filters the HubSpot CONTACT CREATE date, not the date the contact became an MQL. The mirror now carries the stage-entry date for DISPLAY (it shows on queue rows and review cards where present), but the arrival window still keys on the create date. So this answers "created in the window and at this stage now". Say that when you report the number; do not present it as "became an MQL this week". `window.since` in the response is the bound actually applied, so report that rather than a date you worked out yourself.';

export function queueLeadTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await queueLeads(ctx.orgId, {
        contactRefs: args.contact_refs,
        triggerType: args.trigger_type,
        allowedSourceSlugs: ctx.allowedSourceSlugs,
        briefedBy: {
          agentSlug: ctx.agentSlug,
          missionRunId: ctx.missionRunId,
          userId: ctx.userId,
        },
      });
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'queue_lead',
      description: 'Put leads on the personalization queue (the /gtm/personalization page) — ONE call for the whole batch, passing every ref at once. Takes CRM mirror refs (the `ref` field from hubspot_count_contacts, e.g. "contacts:9412") and reads name, title, company, entrance source and email engagement from the mirror itself, so you never supply them and nothing can be invented. Phase 1 records NO research: claims, missing and the draft sequence stay empty and confidence stays null. Returns the counts first — requested, queued (rows actually written), alreadyQueued (already on the queue, which is what a re-fire looks like), notInMirror (refs with no CRM record), and queueTotal. Report `queued` and `alreadyQueued`, not the number of refs you sent. Running this twice on the same leads is a no-op by construction.',
      schema: z.object({
        contact_refs: z.array(z.string().min(1)).min(1).max(500).describe('CRM mirror refs from hubspot_count_contacts (`ref`), e.g. ["contacts:9412","contacts:9413"]. Send them all in one call.'),
        trigger_type: z.enum(['new', 'stale']).default('new').describe('Why the sweep picked the lead up. Phase 1 queues fresh arrivals, so "new".'),
      }),
    },
  );
}

export function getLeadLedgerTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await leadLedger(ctx.orgId, { status: args.status, limit: args.limit });
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'get_lead_ledger',
      description: 'Read the personalization queue back (the /gtm/personalization page): who is already queued, in which lane, with what was recorded about them. Returns the TOTAL first, then one page of rows. Use it before queueing to see what past runs already covered, and after queueing to confirm what landed. This reads the QUEUE, not HubSpot — use hubspot_count_contacts for the CRM records themselves.',
      schema: z.object({
        status: z.enum(['queued', 'ready_for_review', 'handed_off', 'held', 'sent']).optional().describe('Narrow to one lane. Omit for every lane.'),
        limit: z.number().int().positive().max(200).optional().describe('Rows per page (default 50). Does NOT limit `total`.'),
      }),
    },
  );
}

export function reconcileMqlWindowTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const result = await reconcileMqlWindow(ctx.orgId, {
          lifecycleStages: args.lifecycle_stages,
          sinceDays: args.since_days,
          createdAfter: args.created_after,
          createdBefore: args.created_before,
          allowedSourceSlugs: ctx.allowedSourceSlugs,
        });
        return JSON.stringify(result, null, 2);
      } catch (err) {
        // A typed refusal, not a throw: a stage the CRM does not hold would
        // otherwise reconcile to zero gaps and read as full coverage.
        if (err instanceof UnknownStageError) {
          return JSON.stringify({
            error: 'unknown_lifecycle_stage',
            message: 'NO RECONCILIATION RETURNED. One or more lifecycle stages do not exist in the CRM, so the coverage check would be meaningless. Re-call with a value from `available_values` — do NOT report zero gaps.',
            not_found: err.notFound,
            available_values: err.available,
          }, null, 2);
        }
        if (err instanceof TypeError) {
          return JSON.stringify({ error: 'bad_argument', message: err.message });
        }
        throw err;
      }
    },
    {
      name: 'reconcile_mql_window',
      description: `Coverage check: recompute the window's arrivals from the CRM mirror (no writes) and diff them against the personalization queue. Returns arrivals, queued, and every unqueued lead BY NAME with why. Run this at the end of a queueing pass and report the gap count; if it is non-zero, queue what you missed and re-run. ${WINDOW_CAVEAT}`,
      schema: z.object({
        lifecycle_stages: z.array(z.string().min(1)).min(1).describe('Exact lifecycle stage strings, read from `facets.lifecycleStage` on a hubspot_count_contacts call — e.g. ["marketingqualifiedlead"]. Never pass a friendly label like "MQL"; it will be refused.'),
        since_days: z.number().positive().max(365).optional().describe('Trailing window in days, resolved on the SERVER clock (default 7). Use this rather than created_after; it does not require you to know today\'s date. Pass the SAME value the queueing pass used.'),
        created_after: z.string().optional().describe('ISO date, e.g. "2026-08-19". Only when the caller named an explicit start date; since_days wins over it.'),
        created_before: z.string().optional().describe('ISO date. End of the window, exclusive.'),
      }),
    },
  );
}

/* ------------------------------------------------------------------ */
/* Brief generation                                                    */
/* ------------------------------------------------------------------ */

/**
 * The stamp `lead_brief.brief_version` carries for a researched row: the model
 * that wrote it plus the skill version that told it how.
 * @param ctx
 * @param skillVersion
 */
function briefVersionStamp(ctx: RuntimeContext, skillVersion: number): string {
  const model = ctx.harnessConfig.model ?? resolvedModelId('main');
  return `${model}#write-lead-brief-v${skillVersion}`;
}

export function nextLeadToBriefTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const result = await claimLeadToBrief(ctx.orgId);
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'next_lead_to_brief',
      description: `Hand out the next queued lead that still needs a brief, OLDEST ARRIVAL FIRST. Call it, brief that one lead, save it, then call this again; stop when \`lead\` comes back null. Do NOT ask for more than one lead at a time and do not pick leads yourself from get_lead_ledger. Taking the lead COUNTS the try, so a lead you claim and then abandon has spent one of its ${MAX_BRIEF_ATTEMPTS} tries whatever you report. \`attempt\` is which try this is and \`attemptsRemaining\` is what is left. \`regenerateNote\` is a reviewer's instruction for the rewrite when present, and it is the most important input you have: follow it. \`waiting\` is how many unbriefed leads remain after this one, and \`surfaced\` names leads that just ran out of tries and moved to Review with their error. Nothing needing a brief means the sweep is done, which is the normal outcome on most runs.`,
      schema: z.object({}),
    },
  );
}

export function saveLeadBriefTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await saveLeadBrief(ctx.orgId, {
        contactRef: args.contact_ref,
        sections: args.sections,
        claims: args.claims,
        missing: args.missing,
        confidence: args.confidence,
        briefVersion: briefVersionStamp(ctx, args.skill_version),
        briefedBy: {
          agentSlug: ctx.agentSlug,
          missionRunId: ctx.missionRunId,
          userId: ctx.userId,
        },
      });
      if (!result.saved) {
        return JSON.stringify({
          error: 'not_on_queue',
          message: 'NOTHING WAS SAVED. No queue row carries that contact_ref, so the brief was discarded. Use the exact `contactRef` next_lead_to_brief handed you.',
          contact_ref: result.contactRef,
        }, null, 2);
      }
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'save_lead_brief',
      description: 'Save the finished brief onto the lead and move it to Review. Call it EXACTLY ONCE per lead, at the end of the write-lead-brief skill. It writes the brief and nothing else: name, title, company, entrance source and the engagement counters were read off the CRM mirror when the lead was queued, are not arguments here, and cannot be changed by anything you write, so a re-run can never change who the lead is. The saved row is echoed back with `identity` so you can see what it kept. Save the brief you actually wrote, including the Missing section; a gap stated is worth more to a reviewer than a gap smoothed over.',
      schema: z.object({
        contact_ref: z.string().min(1).describe('The `contactRef` from next_lead_to_brief, e.g. "contacts:9412".'),
        sections: z.array(z.object({
          heading: z.string().min(1).describe('Section heading, e.g. "Prospect", "Recommended Angle".'),
          body: z.string().min(1).describe('The written section as prose or markdown. This is what the reviewer reads.'),
        })).min(1).describe('The brief\'s written sections in the order the skill lists them, from Prospect through Brief Confidence. Do not collapse them into one blob.'),
        claims: z.array(z.object({
          text: z.string().min(1).describe('The claim itself, one sentence.'),
          kind: z.string().min(1).describe('"Fact" or "Inference". A hypothesis belongs in the Workflow Hypotheses section, not here.'),
          source: z.string().min(1).describe('An openable source: a URL, or the CRM record ref when the claim came off the mirror.'),
          date: z.string().optional().describe('Source date where the source carries one, ISO or as printed.'),
        })).describe('The meaningful claims from Research That Matters, each with where it came from. An unsourced claim is not a claim; leave it out rather than sourcing it to nothing.'),
        missing: z.array(z.string().min(1)).describe('The Missing list: the structural limits plus what could not be established for this lead. Never empty in practice, because the structural limits always apply.'),
        confidence: z.number().min(0).max(1).describe('Brief confidence, 0.00 to 1.00: how strongly the available evidence supports the brief and its selected angle. Not a prediction that the prospect replies. A low score is fine and is not a reason to withhold the brief.'),
        skill_version: z.number().int().positive().describe('The `version` from the write-lead-brief skill frontmatter. It stamps the row so a brief can be traced to the prompt that produced it.'),
      }),
    },
  );
}

export function saveHandoffBriefTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await saveHandoffBrief(ctx.orgId, {
        contactRef: args.contact_ref,
        sections: args.sections,
        trigger: args.trigger,
      });
      if (!result.saved) {
        return JSON.stringify({
          error: 'not_on_ledger',
          message: 'NOTHING WAS SAVED. No lead row carries that contact_ref, so the handoff brief was discarded. Use the exact `contactRef` from the lead ledger.',
          contact_ref: result.contactRef,
        }, null, 2);
      }
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'save_handoff_brief',
      description: 'Save the call prep for a lead LEAVING your care, at the end of the write-handoff-brief skill. Call it EXACTLY ONCE per handoff. It writes the handoff sections and the trigger and NOTHING else: the review brief, its claims, its confidence and the lead\'s lane are left exactly as they were, because that brief recorded a decision that has already been taken. This is prep for a person about to have a conversation, not a re-review of the copy — write where the thread stands, what the lead actually did, the one or two hypotheses worth testing live, and what to ask first. It does not send anything: the HubSpot note is written when a person ACCEPTS the handoff.',
      schema: z.object({
        contact_ref: z.string().min(1).describe('The lead\'s CRM mirror ref, e.g. "contacts:9412".'),
        trigger: z.enum(['reply', 'intent', 'routed']).describe('Why the lead left: "reply" (they answered), "intent" (pages or files crossed the threshold), "routed" (a reviewer sent it to a person).'),
        sections: z.array(z.object({
          heading: z.string().min(1).describe('Section heading, e.g. "Where the thread stands".'),
          body: z.string().min(1).describe('The written section. Bullet lists where the content is a list — this is read in two minutes before a call.'),
        })).min(1).describe('The handoff brief\'s sections in the order the skill lists them. Quote a reply verbatim rather than paraphrasing it.'),
      }),
    },
  );
}

export function recordBriefFailureTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await recordBriefFailure(ctx.orgId, args.contact_ref, args.error);
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'record_brief_failure',
      description: `Record why a lead could not be briefed. Call it as soon as you give up on a lead, before moving to the next one, and then keep going. This does NOT retry and does not spend a try: the try was already counted when you claimed the lead. It stores the text a reviewer reads if the lead runs out of tries. Write what actually went wrong in plain words, including the tool and the message you saw. After ${MAX_BRIEF_ATTEMPTS} tries the lead moves to Review carrying this text where the brief would be, so a vague note here is a reviewer with nothing to act on.`,
      schema: z.object({
        contact_ref: z.string().min(1).describe('The `contactRef` from next_lead_to_brief.'),
        error: z.string().min(1).describe('What went wrong, in plain words. Name the tool and quote the message where you have one.'),
      }),
    },
  );
}

/* ------------------------------------------------------------------ */
/* Draft generation                                                    */
/* ------------------------------------------------------------------ */

export function nextBriefToDraftTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const result = await claimBriefToDraft(ctx.orgId);
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'next_brief_to_draft',
      description: `Hand out the next BRIEFED lead that still needs its outreach drafted, OLDEST ARRIVAL FIRST, with the whole brief attached (sections, claims, missing, confidence) so you never re-read it elsewhere. Call it, draft that one lead per the draft-mql-sequence skill, save with save_draft_sequence, then call this again; stop when \`lead\` comes back null. Taking the lead COUNTS the try (${MAX_DRAFT_ATTEMPTS} total), same contract as next_lead_to_brief. Draft whatever the confidence says: a low score is drafted anyway and the reviewer's edits are the training signal. Leads whose briefing failed are never handed out here.`,
      schema: z.object({}),
    },
  );
}

export function saveDraftSequenceTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await saveDraftSequence(ctx.orgId, {
        contactRef: args.contact_ref,
        sends: args.sends,
        recommendedSequence: args.recommended_sequence,
        senderEmail: args.sender_email,
        hubspotUserId: args.hubspot_user_id,
        briefedBy: {
          agentSlug: ctx.agentSlug,
          missionRunId: ctx.missionRunId,
          userId: ctx.userId,
        },
      });
      if (!result.saved) {
        return JSON.stringify({ error: result.reason, message: result.message, contact_ref: result.contactRef }, null, 2);
      }
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'save_draft_sequence',
      description: 'Save the drafted, numbered sends onto the briefed lead AND surface it for review — this one call writes the drafts and proposes the personalization.enroll review item server-side, so never call propose_action for it yourself. Call it EXACTLY ONCE per lead, at the end of the draft-mql-sequence skill. The recommendation must be an EXISTING sequence from hubspot_list_sequences: an id the library does not hold is refused and nothing is saved. Re-running on the same lead updates the one pending review item, never duplicates it. Do NOT claim anything was sent or enrolled — the drafts wait for a human\'s Enroll.',
      schema: z.object({
        contact_ref: z.string().min(1).describe('The `contactRef` from next_brief_to_draft, e.g. "contacts:9412".'),
        sends: z.array(z.object({
          day: z.number().int().min(0).optional().describe('The send\'s day offset in the recommended sequence\'s cadence (Day 0, Day 4, …), when the sequence defines one.'),
          subject: z.string().min(1).describe('Subject line, in the founder voice.'),
          body: z.string().min(1).describe('The personalized send body. This is what the reviewer reads and edits.'),
        })).min(1).max(10).describe('The numbered sends IN ORDER — one entry per send of the recommended sequence, personalized for this lead. Steps are numbered by position server-side.'),
        recommended_sequence: z.object({
          id: z.string().min(1).describe('The sequence id, exactly as hubspot_list_sequences returned it. Never invent one.'),
          name: z.string().min(1).describe('The sequence name, as returned.'),
          reason: z.string().optional().describe('One or two sentences: why THIS sequence for THIS lead. Renders on the review card.'),
        }).describe('The existing HubSpot sequence the lead should be enrolled into.'),
        sender_email: z.string().min(1).describe('The sender the enrollment will run as — the `userEmail` you passed to hubspot_list_sequences.'),
        hubspot_user_id: z.string().optional().describe('The `userId` from the hubspot_list_sequences response. Pass it through; it scopes verification and the enrollment.'),
      }),
    },
  );
}

export function recordDraftFailureTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await recordDraftFailure(ctx.orgId, args.contact_ref, args.error);
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'record_draft_failure',
      description: `Record why a briefed lead could not be drafted. Call it as soon as you give up on a lead, before moving to the next one, then keep going. The try was already counted by the claim; after ${MAX_DRAFT_ATTEMPTS} tries the lead simply stops being handed out and a person reads this text on it. Name the tool that failed and quote the message.`,
      schema: z.object({
        contact_ref: z.string().min(1).describe('The `contactRef` from next_brief_to_draft.'),
        error: z.string().min(1).describe('What went wrong, in plain words.'),
      }),
    },
  );
}

export function hubspotListSequencesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return JSON.stringify(resolved, null, 2);
      }
      const { listSequences, resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
      const user = await resolveHubspotUserId(resolved.client, args.user_email);
      if (!user.ok) {
        return JSON.stringify(user, null, 2);
      }
      const sequences = await listSequences(resolved.client, user.data.userId);
      if (!sequences.ok) {
        return JSON.stringify(sequences, null, 2);
      }
      return JSON.stringify({
        ok: true,
        source: 'hubspot_live',
        count: sequences.data.length,
        userEmail: args.user_email,
        userId: user.data.userId,
        sequences: sequences.data,
      }, null, 2);
    },
    {
      name: 'hubspot_list_sequences',
      description: 'Reads HubSpot LIVE: the sender\'s EXISTING sequence library — the only sequences a draft may recommend. Returns the count first, then {id, name, stepCount} per sequence, plus the `userId` that save_draft_sequence and the enrollment need (pass it through as hubspot_user_id). Recommending an id this tool did not return will be refused at save time. If the token lacks the sequences scope, the error names the scope; report that rather than guessing.',
      schema: z.object({
        user_email: z.string().min(1).describe('The sender whose sequence library to read, e.g. the founder\'s email. Sequences are per-user in HubSpot.'),
      }),
    },
  );
}

/**
 * Build the personalization tool set — empty unless the agent's harness config
 * GRANTS them by name. The gate lives here, so every consumer of the registry
 * enforces the same grant.
 * @param ctx
 */
export function personalizationTools(ctx: RuntimeContext) {
  const grants = new Set(ctx.harnessConfig.grantTools ?? []);
  const all = [
    queueLeadTool(ctx),
    getLeadLedgerTool(ctx),
    reconcileMqlWindowTool(ctx),
    nextLeadToBriefTool(ctx),
    saveLeadBriefTool(ctx),
    saveHandoffBriefTool(ctx),
    recordBriefFailureTool(ctx),
    nextBriefToDraftTool(ctx),
    saveDraftSequenceTool(ctx),
    recordDraftFailureTool(ctx),
    hubspotListSequencesTool(ctx),
  ];
  return all.filter(t => grants.has(t.name));
}
