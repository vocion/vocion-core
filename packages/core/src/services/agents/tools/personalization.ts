/**
 * Personalization-lane tools — new MQLs become queue rows, then each one is
 * researched into a brief. No draft copy, no Loom, no touch plan, no sends,
 * no HubSpot writes.
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
  claimLeadToBrief,
  leadLedger,
  MAX_BRIEF_ATTEMPTS,
  queueLeads,
  reconcileMqlWindow,
  recordBriefFailure,
  saveLeadBrief,
  UnknownStageError,
} from '@/services/PersonalizationQueueService';

/** Tool names that exist only for agents granted them via `harness.grantTools`. */
export const PERSONALIZATION_TOOL_NAMES = [
  'queue_lead',
  'get_lead_ledger',
  'reconcile_mql_window',
  'next_lead_to_brief',
  'save_lead_brief',
  'record_brief_failure',
] as const;

const WINDOW_CAVEAT = 'The window filters the HubSpot CONTACT CREATE date, not the date the contact became an MQL, because the mirror does not carry a stage-entry date. So this answers "created in the window and at this stage now". Say that when you report the number; do not present it as "became an MQL this week". `window.since` in the response is the bound actually applied, so report that rather than a date you worked out yourself.';

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
    recordBriefFailureTool(ctx),
  ];
  return all.filter(t => grants.has(t.name));
}
