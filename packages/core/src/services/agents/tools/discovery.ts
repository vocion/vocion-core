/**
 * Discovery-lane tools — the agent-driven replacement for the discovery-sweep
 * job. The RevOps Lead decides which calls to assess, when, and what to do
 * with the answer; the privacy and audit guarantees stay STRUCTURAL:
 *
 *   - No tool here ever returns transcript body. `classify_call` reads it
 *     server-side through the content gate, scores it with ONE fixed model
 *     call, and persists verdict + provenance before returning only the
 *     structured scores. Read, classify, and record are the same function,
 *     so an assessed-but-unlogged call is not a reachable state.
 *   - These tools are GRANTED, not default: they build only for agents whose
 *     `harness.grantTools` names them (the workspace grants them to the
 *     RevOps Lead).
 *
 * Registered via `discoveryTools(ctx)` in `./registry.ts`.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { actionRunSchema, discoveryCandidateSchema } from '@/models/Schema';
import {
  classifyCall,
  ClassifyCallError,
  ContentGateError,
  filterEligible,
  loadHubspotDocs,
  matchWindow,
  reconcileWindow,
} from '@/services/DiscoveryDetectionService';

/** Tool names that exist only for agents granted them via `harness.grantTools`. */
export const DISCOVERY_TOOL_NAMES = [
  'get_eligible_parties',
  'match_meetings',
  'classify_call',
  'list_discovery_candidates',
  'reconcile_discovery_window',
] as const;

const eligibleArgs = {
  owner_ids: z.array(z.string()).optional().describe('HubSpot owner ids the records must belong to (empty/omitted = any owner)'),
  lifecycle_stages: z.array(z.string()).optional().describe('Allowed contact lifecycle stages, e.g. ["lead","salesqualifiedlead"]'),
  deal_stages: z.array(z.string()).optional().describe('Allowed deal stages (omitted = any open deal)'),
};

const windowArgs = {
  seller_domain: z.string().min(1).describe('The seller\'s own email domain, e.g. "metacto.com" — anything else on a call is external'),
  since_days: z.number().positive().max(30).default(3).describe('Trailing window of meetings to consider'),
  allow_calendly_external: z.boolean().optional().describe('Count a seller-hosted call with an external guest even without a CRM record (default true)'),
  ...eligibleArgs,
};

type WindowArgs = {
  seller_domain: string;
  since_days: number;
  allow_calendly_external?: boolean;
  owner_ids?: string[];
  lifecycle_stages?: string[];
  deal_stages?: string[];
};

function windowOptions(args: WindowArgs) {
  return {
    sellerDomain: args.seller_domain,
    sinceDays: args.since_days,
    allowCalendlyExternal: args.allow_calendly_external,
    eligible: {
      ownerIds: args.owner_ids,
      lifecycleStages: args.lifecycle_stages,
      dealStages: args.deal_stages,
    },
  };
}

export function getEligiblePartiesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const docs = await loadHubspotDocs(ctx.orgId);
      const parties = filterEligible(docs, {
        ownerIds: args.owner_ids,
        lifecycleStages: args.lifecycle_stages,
        dealStages: args.deal_stages,
      });
      return JSON.stringify({
        count: parties.length,
        parties: parties.slice(0, 200).map(p => ({ ref: p.ref, type: p.type, label: p.label ?? null, domains: p.domains })),
        ...(parties.length > 200 ? { note: 'truncated to 200 parties' } : {}),
      }, null, 2);
    },
    {
      name: 'get_eligible_parties',
      description: 'List the CRM parties the seller owns and is actively working — the allow-list a meeting must match before its transcript can ever be read. Use to sanity-check scope before matching.',
      schema: z.object(eligibleArgs),
    },
  );
}

export function matchMeetingsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await matchWindow(ctx.orgId, windowOptions(args as WindowArgs));
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'match_meetings',
      description: 'Match the window\'s meetings against the eligible CRM parties (metadata only — titles, hosts, attendees; NEVER transcript content) and record every match on the discovery ledger. Returns each match with its candidateId, whether a transcript exists, and its assessment status. Run this before classify_call.',
      schema: z.object(windowArgs),
    },
  );
}

export function classifyCallTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const result = await classifyCall(ctx.orgId, args.candidate_id, {
          discoveryThreshold: args.discovery_threshold,
          readyThreshold: args.ready_threshold,
          assessedBy: {
            agentSlug: ctx.agentSlug,
            missionRunId: ctx.missionRunId,
            userId: ctx.userId,
          },
        });
        return JSON.stringify(result, null, 2);
      } catch (err) {
        // Typed refusals — structural, not prompted. The transcript is never
        // in play here: the gate refused before any read.
        if (err instanceof ClassifyCallError) {
          return JSON.stringify({ error: err.code, message: err.message });
        }
        if (err instanceof ContentGateError) {
          return JSON.stringify({ error: 'content_gate_refused', message: err.message });
        }
        throw err;
      }
    },
    {
      name: 'classify_call',
      description: 'Assess ONE matched meeting (by candidateId from match_meetings): the server reads the transcript through the privacy gate, scores it with one fixed classifier call, and writes the verdict + full provenance to the ledger. Returns only the structured scores, reasoning, and route — never transcript content. Refuses calls that never matched.',
      schema: z.object({
        candidate_id: z.number().int().positive().describe('discovery_candidate id from match_meetings'),
        discovery_threshold: z.number().min(0).max(1).optional().describe('Route threshold for is_discovery confidence (default 0.6). Recorded on the row.'),
        ready_threshold: z.number().min(0).max(1).optional().describe('Route threshold for proposal_ready confidence (default 0.75). Recorded on the row.'),
      }),
    },
  );
}

export function listDiscoveryCandidatesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const conds = [eq(discoveryCandidateSchema.orgId, ctx.orgId)];
      if (args.since_days) {
        conds.push(gte(discoveryCandidateSchema.matchedAt, new Date(Date.now() - args.since_days * 86_400_000)));
      }
      if (args.status) {
        conds.push(eq(discoveryCandidateSchema.status, args.status));
      }
      const rows = await db
        .select({
          candidateId: discoveryCandidateSchema.id,
          meetingExternalId: discoveryCandidateSchema.meetingExternalId,
          title: discoveryCandidateSchema.meetingTitle,
          start: discoveryCandidateSchema.meetingStart,
          matchType: discoveryCandidateSchema.matchType,
          matchReason: discoveryCandidateSchema.matchReason,
          status: discoveryCandidateSchema.status,
          classification: discoveryCandidateSchema.classification,
          route: discoveryCandidateSchema.route,
          thresholds: discoveryCandidateSchema.thresholds,
          skippedReason: discoveryCandidateSchema.skippedReason,
          classifiedAt: discoveryCandidateSchema.classifiedAt,
          reviewActionRunId: discoveryCandidateSchema.reviewActionRunId,
          reviewStatus: actionRunSchema.status,
        })
        .from(discoveryCandidateSchema)
        .leftJoin(actionRunSchema, eq(actionRunSchema.id, discoveryCandidateSchema.reviewActionRunId))
        .where(and(...conds))
        .orderBy(desc(discoveryCandidateSchema.matchedAt))
        .limit(args.limit ?? 50);
      return JSON.stringify(rows, null, 2);
    },
    {
      name: 'list_discovery_candidates',
      description: 'Query the discovery ledger: past assessments with scores, route, skipped reason, and the review-queue status of each surfaced call. Use to see what has already been assessed before re-classifying, and to check what awaits human review.',
      schema: z.object({
        since_days: z.number().positive().max(90).optional().describe('Only candidates matched in the trailing N days'),
        status: z.enum(['matched', 'classified', 'routed', 'dropped']).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
    },
  );
}

export function reconcileDiscoveryWindowTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const result = await reconcileWindow(ctx.orgId, windowOptions(args as WindowArgs));
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'reconcile_discovery_window',
      description: 'Coverage check: recompute the window\'s matches (metadata only, no model spend, no writes) and diff them against the ledger. Returns every gap — matched meetings never recorded, or recorded but never assessed, with why. Run this at the end of a detection pass and act on the gaps.',
      schema: z.object(windowArgs),
    },
  );
}

/**
 * Build the discovery tool set for this agent — empty unless the agent's
 * harness config GRANTS them by name. The gate lives here (not in the
 * callers) so every consumer of the registry — in-process harness, BYOA tool
 * endpoint, catalog serialization — enforces the same grant.
 * @param ctx
 */
export function discoveryTools(ctx: RuntimeContext) {
  const grants = new Set(ctx.harnessConfig.grantTools ?? []);
  const all = [
    getEligiblePartiesTool(ctx),
    matchMeetingsTool(ctx),
    classifyCallTool(ctx),
    listDiscoveryCandidatesTool(ctx),
    reconcileDiscoveryWindowTool(ctx),
  ];
  return all.filter(t => grants.has(t.name));
}
