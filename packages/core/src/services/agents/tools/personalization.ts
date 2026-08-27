/**
 * Personalization-lane tools — phase 1: new MQLs become rows on the
 * personalization queue. No research, no briefs, no drafts, no sends, no
 * HubSpot writes.
 *
 * The guarantees are STRUCTURAL, the same way the discovery lane's are:
 *
 *   - `queue_lead` takes CRM mirror refs and re-reads those records itself,
 *     so the agent supplies WHICH leads and never WHAT is recorded about
 *     them. A phase-1 row therefore cannot carry research that never ran.
 *   - The unique index on (orgId, contactRef) is the de-duplication. There is
 *     no de-dup logic to get wrong; a re-fire inserts nothing.
 *   - These tools are GRANTED, not default: they build only for agents whose
 *     `harness.grantTools` names them.
 *
 * Registered via `personalizationTools(ctx)` in `./registry.ts`.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  leadLedger,
  queueLeads,
  reconcileMqlWindow,
  UnknownStageError,
} from '@/services/PersonalizationQueueService';

/** Tool names that exist only for agents granted them via `harness.grantTools`. */
export const PERSONALIZATION_TOOL_NAMES = [
  'queue_lead',
  'get_lead_ledger',
  'reconcile_mql_window',
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
      description: 'Put leads on the personalization queue (the /gtm/personalization page) — ONE call for the whole batch, passing every ref at once. Takes CRM mirror refs (the `ref` field from get_hubspot_contacts, e.g. "contacts:9412") and reads name, title, company, entrance source and email engagement from the mirror itself, so you never supply them and nothing can be invented. Phase 1 records NO research: claims, missing and the draft sequence stay empty and confidence stays null. Returns the counts first — requested, queued (rows actually written), alreadyQueued (already on the queue, which is what a re-fire looks like), notInMirror (refs with no CRM record), and queueTotal. Report `queued` and `alreadyQueued`, not the number of refs you sent. Running this twice on the same leads is a no-op by construction.',
      schema: z.object({
        contact_refs: z.array(z.string().min(1)).min(1).max(500).describe('CRM mirror refs from get_hubspot_contacts (`ref`), e.g. ["contacts:9412","contacts:9413"]. Send them all in one call.'),
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
      description: 'Read the personalization queue back (the /gtm/personalization page): who is already queued, in which lane, with what was recorded about them. Returns the TOTAL first, then one page of rows. Use it before queueing to see what past runs already covered, and after queueing to confirm what landed. This reads the QUEUE, not HubSpot — use get_hubspot_contacts for the CRM records themselves.',
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
        lifecycle_stages: z.array(z.string().min(1)).min(1).describe('Exact lifecycle stage strings, read from `facets.lifecycleStage` on a get_hubspot_contacts call — e.g. ["marketingqualifiedlead"]. Never pass a friendly label like "MQL"; it will be refused.'),
        since_days: z.number().positive().max(365).optional().describe('Trailing window in days, resolved on the SERVER clock (default 7). Use this rather than created_after; it does not require you to know today\'s date. Pass the SAME value the queueing pass used.'),
        created_after: z.string().optional().describe('ISO date, e.g. "2026-08-19". Only when the caller named an explicit start date; since_days wins over it.'),
        created_before: z.string().optional().describe('ISO date. End of the window, exclusive.'),
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
  ];
  return all.filter(t => grants.has(t.name));
}
