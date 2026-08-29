/**
 * CRM COUNT tools — the STRUCTURED read path over the synced HubSpot mirror.
 *
 * One tool per object type, named `hubspot_count_*` because counting is what
 * the mirror does better than the live API: exact totals, facet breakdowns,
 * sums, trailing windows. Record-level reads live in the DIRECT tools
 * (`hubspot_get_contact`, `hubspot_search_*`, `hubspot_company_*`, …), which
 * hit the live API — the routing rule every description repeats: fetching a
 * record goes to the source, counting goes to the mirror.
 *
 * `search_knowledge` answers "what was said" and is a relevance top-k, so it
 * can never count. Every response here therefore leads with an exact `total`
 * from COUNT(*), carries `facets` so filter values are DISCOVERABLE rather
 * than guessed, pages explicitly, and names any field the mirror does not
 * carry in `unavailableFields` so a missing column produces an honest refusal
 * instead of a plausible number.
 *
 * NOT granted-only: these build for any agent whose `connectorSources`
 * include a HubSpot source. The discovery lane's grant gate protects
 * transcript reading (`classify_call`), which is a different concern from
 * listing CRM records.
 */

import type { RuntimeContext } from '../types';
import type { CrmObjectType, CrmQueryOptions } from '@/services/CrmRecordsService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { queryCrmRecords } from '@/services/CrmRecordsService';

/** A source slug that belongs to the HubSpot connector family. */
const HUBSPOT_SLUG = /^hubspot(?:$|-)/;

export function hasHubspotSource(ctx: RuntimeContext): boolean {
  return ctx.connectorSources.some(s => HUBSPOT_SLUG.test(s));
}

const pageArgs = {
  query: z.string().optional().describe('Case-insensitive substring over name, email, domain, company, and HubSpot id. Use to answer "is X in the CRM?" — total=0 means no record.'),
  owner_ids: z.array(z.string()).optional().describe('HubSpot owner ids the records must belong to (omit = any owner)'),
  created_within_days: z.number().positive().max(365).optional().describe('Trailing window in days, resolved on the SERVER clock. Use this for "added this week", "the last 7 days", "this month" — it does NOT require you to know today\'s date, and getting that wrong silently narrows the result set instead of erroring.'),
  created_after: z.string().optional().describe('Only records created at or after this ISO date, e.g. "2026-08-14". Use ONLY when the caller named an explicit date; for a trailing window use created_within_days. Errors on an unparseable date rather than guessing.'),
  created_before: z.string().optional().describe('Only records created strictly before this ISO date'),
  limit: z.number().int().positive().max(200).optional().describe('Records per page (default 50, max 200). Does NOT limit `total`.'),
  offset: z.number().int().min(0).optional().describe('Records to skip — pass the previous offset + returned to get the next page'),
};

/** Tool args are snake_case for the model; the service takes camelCase. */
type ToolArgs = {
  query?: string;
  owner_ids?: string[];
  lifecycle_stages?: string[];
  deal_stages?: string[];
  pipelines?: string[];
  industries?: string[];
  status?: 'open' | 'closed';
  created_within_days?: number;
  created_after?: string;
  created_before?: string;
  limit?: number;
  offset?: number;
};

function toOptions(args: ToolArgs): CrmQueryOptions {
  return {
    query: args.query,
    ownerIds: args.owner_ids,
    lifecycleStages: args.lifecycle_stages,
    dealStages: args.deal_stages,
    pipelines: args.pipelines,
    industries: args.industries,
    dealStatus: args.status,
    createdWithinDays: args.created_within_days,
    createdAfter: args.created_after,
    createdBefore: args.created_before,
    limit: args.limit,
    offset: args.offset,
  };
}

/**
 * Shared response projection: counts first, then the page.
 * @param ctx
 * @param objectType
 * @param args
 */
async function run(ctx: RuntimeContext, objectType: CrmObjectType, args: ToolArgs) {
  let result;
  try {
    result = await queryCrmRecords(ctx.orgId, objectType, {
      ...toOptions(args),
      allowedSourceSlugs: ctx.allowedSourceSlugs,
    });
  } catch (err) {
    // A bad argument (an unparseable date, say) is the agent's to fix, so hand
    // it back as data rather than throwing the turn away.
    return JSON.stringify({ error: 'bad_argument', message: (err as Error).message });
  }

  if (result.sources.length === 0) {
    return JSON.stringify({
      total: 0,
      error: 'no_hubspot_source',
      message: `No HubSpot source is connected (or permitted for this user) in this workspace, so ${objectType} cannot be counted. Say that rather than estimating.`,
    }, null, 2);
  }

  // A filter value that does not exist in the data is a caller mistake, not a
  // zero. Refuse to hand back a count at all in that case: a `total` next to a
  // warning gets reported as the answer, whereas an absent total forces the
  // retry. This is the structural version of "do not trust an empty result".
  const unknown = Object.entries(result.unknownFilterValues);
  if (unknown.length > 0) {
    return JSON.stringify({
      error: 'unknown_filter_value',
      message: 'NO COUNT RETURNED. One or more filter values do not exist in the CRM, so any count would be wrong. Re-call with a value from `available_values` below — do NOT report a number, and do NOT say there are none.',
      unknown_filters: unknown.map(([key, v]) => ({ field: key, requested: v.requested, not_found: v.notFound })),
      available_values: result.facets,
    }, null, 2);
  }

  return JSON.stringify({
    object_type: objectType,
    total: result.total,
    returned: result.returned,
    offset: result.offset,
    has_more: result.hasMore,
    ...(result.totalAmount === undefined ? {} : { total_amount: result.totalAmount }),
    facets: result.facets,
    ...(result.facetAmounts ? { facet_amounts: result.facetAmounts } : {}),
    unavailable_fields: result.unavailableFields,
    ...(result.createdAfter ? { created_after_applied: result.createdAfter } : {}),
    as_of: result.asOf ? result.asOf.toISOString() : null,
    sources_read: result.sources,
    ...(result.hasMore
      ? { next_offset: result.offset + result.returned, note: `Showing ${result.returned} of ${result.total}. Report the TOTAL, not the page size; pass offset=${result.offset + result.returned} for the next page.` }
      : {}),
    records: result.records,
  }, null, 2);
}

const FRESHNESS = 'Reads the synced CRM mirror, so `as_of` is the last sync time — call freshen_source("hubspot") first if the question implies "right now".';
const HONESTY = 'Anything listed in `unavailable_fields` is NOT synced for these records: say the field is unavailable rather than estimating it. Report `total` (the exact COUNT), never the number of records shown.';
const ROUTING = 'Routing: FETCHING a record goes to the source, COUNTING goes here (the mirror). One specific person → hubspot_get_contact; find people by name → hubspot_search_contacts; one account, its deals, or its activity → hubspot_get_company / hubspot_company_deals / hubspot_company_activity; how many / how much / broken down by → the hubspot_count_* tools.';

export function hubspotCountContactsTool(ctx: RuntimeContext) {
  return tool(
    async args => run(ctx, 'contacts', args as ToolArgs),
    {
      name: 'hubspot_count_contacts',
      description: `Counts HubSpot CONTACTS (people) in the synced CRM mirror: exact totals, lifecycle/source breakdowns, and trailing windows. Use this for any "how many contacts/leads/MQLs" question — never search_knowledge, which returns at most 15 relevance hits and cannot count. Filter with lifecycle_stages; \`facets.lifecycleStage\` returns every stage present with its count, so read it to learn the exact stage strings (e.g. "lead", "salesqualifiedlead") instead of guessing. Use created_within_days for "added this week/month" — it resolves the window on the server, so you never have to know today's date. ${ROUTING} ${FRESHNESS} ${HONESTY}`,
      schema: z.object({
        lifecycle_stages: z.array(z.string()).optional().describe('Contact lifecycle stages, e.g. ["lead"] or ["salesqualifiedlead"]. Omit for ALL contacts. Case-insensitive.'),
        ...pageArgs,
      }),
    },
  );
}

export function hubspotCountDealsTool(ctx: RuntimeContext) {
  return tool(
    async args => run(ctx, 'deals', args as ToolArgs),
    {
      name: 'hubspot_count_deals',
      description: `Counts HubSpot DEALS (the revenue pipeline) in the synced CRM mirror: exact totals, pipeline breakdowns, and summed value by stage/pipeline. Filter with deal_stages / pipelines; \`facets.dealStage\` and \`facets.pipeline\` return every value present with its count, so read them rather than guessing stage names. \`total_amount\` is the summed value across ALL matches and \`facet_amounts\` is that sum broken down per stage and per pipeline — so value-by-stage is ONE call. NEVER page through deals adding amounts up yourself; the sums are already computed over every match, and a page only ever holds part of them. For "open pipeline" pass status:"open". Use created_within_days for "opened this month" — it resolves the window on the server. For ONE company's deal history (including closed-lost and loss reasons) use hubspot_company_deals; for a live pipeline-hygiene list (open deals, stalled first) use hubspot_list_deals. ${ROUTING} ${FRESHNESS} ${HONESTY}`,
      schema: z.object({
        status: z.enum(['open', 'closed']).optional().describe('"open" excludes won AND lost deals. ALWAYS pass this for "open pipeline" questions — it is resolved from the pipeline definitions, so it is correct for custom pipelines whose stage names give no hint. Omit for all deals.'),
        deal_stages: z.array(z.string()).optional().describe('Deal stage LABELS to include (read them from facets.dealStageLabel). Omit for all stages.'),
        pipelines: z.array(z.string()).optional().describe('Pipeline labels to include (read them from facets.pipelineLabel). Omit for all pipelines.'),
        ...pageArgs,
      }),
    },
  );
}

export function hubspotCountCompaniesTool(ctx: RuntimeContext) {
  return tool(
    async args => run(ctx, 'companies', args as ToolArgs),
    {
      name: 'hubspot_count_companies',
      description: `Counts HubSpot COMPANIES (accounts) in the synced CRM mirror: exact totals and breakdowns by industry/size — those attributes live on the COMPANY record, not on contacts. Filter with industries; \`facets.industry\` returns every industry present with its count, and the values are HubSpot enum strings (e.g. "COMPUTER_SOFTWARE", "EDUCATION_MANAGEMENT") — read them off the facets and pass them EXACTLY, never a friendly paraphrase like "education". ${ROUTING} ${FRESHNESS} ${HONESTY}`,
      schema: z.object({
        industries: z.array(z.string()).optional().describe('Industries to include. Omit for ALL companies. Case-insensitive.'),
        ...pageArgs,
      }),
    },
  );
}

/**
 * Build the CRM tool set — present for any agent with a HubSpot source in
 * scope, absent otherwise (so an agent with no CRM access has no CRM tools
 * to hallucinate a call to).
 * @param ctx
 */
export function crmTools(ctx: RuntimeContext) {
  if (!hasHubspotSource(ctx)) {
    return [];
  }
  return [
    hubspotCountContactsTool(ctx),
    hubspotCountDealsTool(ctx),
    hubspotCountCompaniesTool(ctx),
  ];
}
