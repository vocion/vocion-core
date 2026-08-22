/**
 * CRM tools — the STRUCTURED read path over the synced HubSpot mirror.
 *
 * One tool per object type. A tool named for contacts returns contacts, and
 * only contacts: the previous single tool returned contacts + deals +
 * companies, so a model choosing by name could not choose correctly.
 *
 * These answer "how many" and "which ones". `search_knowledge` answers "what
 * was said" and is a relevance top-k, so it can never count. Every response
 * therefore leads with an exact `total` from COUNT(*), carries `facets` so
 * filter values are DISCOVERABLE rather than guessed, pages explicitly, and
 * names any field the mirror does not carry in `unavailableFields` so a
 * missing column produces an honest refusal instead of a plausible number.
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
  created_after: z.string().optional().describe('Only records created at or after this ISO date, e.g. "2026-08-14" — use for "added this week/month". Errors on an unparseable date rather than guessing.'),
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

export function getHubspotContactsTool(ctx: RuntimeContext) {
  return tool(
    async args => run(ctx, 'contacts', args as ToolArgs),
    {
      name: 'get_hubspot_contacts',
      description: `Count and list HubSpot CONTACTS (people) from the CRM. Use this for any "how many contacts/leads/MQLs" question and for looking a person up — never search_knowledge, which returns at most 15 relevance hits and cannot count. Filter with lifecycle_stages; \`facets.lifecycleStage\` returns every stage present with its count, so read it to learn the exact stage strings (e.g. "lead", "salesqualifiedlead") instead of guessing. Use created_after for "added this week/month". For deals use get_hubspot_deals; for companies use get_hubspot_companies. ${FRESHNESS} ${HONESTY}`,
      schema: z.object({
        lifecycle_stages: z.array(z.string()).optional().describe('Contact lifecycle stages, e.g. ["lead"] or ["salesqualifiedlead"]. Omit for ALL contacts. Case-insensitive.'),
        ...pageArgs,
      }),
    },
  );
}

export function getHubspotDealsTool(ctx: RuntimeContext) {
  return tool(
    async args => run(ctx, 'deals', args as ToolArgs),
    {
      name: 'get_hubspot_deals',
      description: `Count and list HubSpot DEALS (the revenue pipeline) from the CRM. Use for "how many deals", pipeline breakdowns, and deal value. Filter with deal_stages / pipelines; \`facets.dealStage\` and \`facets.pipeline\` return every value present with its count, so read them rather than guessing stage names. \`total_amount\` is the summed value across ALL matches and \`facet_amounts\` is that sum broken down per stage and per pipeline — so value-by-stage is ONE call. NEVER page through deals adding amounts up yourself; the sums are already computed over every match, and a page only ever holds part of them. For "open pipeline" pass status:"open". Use created_after for "opened this month". For people use get_hubspot_contacts; for accounts use get_hubspot_companies. ${FRESHNESS} ${HONESTY}`,
      schema: z.object({
        status: z.enum(['open', 'closed']).optional().describe('"open" excludes won AND lost deals. ALWAYS pass this for "open pipeline" questions — it is resolved from the pipeline definitions, so it is correct for custom pipelines whose stage names give no hint. Omit for all deals.'),
        deal_stages: z.array(z.string()).optional().describe('Deal stage LABELS to include (read them from facets.dealStageLabel). Omit for all stages.'),
        pipelines: z.array(z.string()).optional().describe('Pipeline labels to include (read them from facets.pipelineLabel). Omit for all pipelines.'),
        ...pageArgs,
      }),
    },
  );
}

export function getHubspotCompaniesTool(ctx: RuntimeContext) {
  return tool(
    async args => run(ctx, 'companies', args as ToolArgs),
    {
      name: 'get_hubspot_companies',
      description: `Count and list HubSpot COMPANIES (accounts) from the CRM. Use for "how many companies", and for account attributes like industry, domain, and size — those live on the COMPANY record, not on contacts. Filter with industries; \`facets.industry\` returns every industry present with its count, and the values are HubSpot enum strings (e.g. "COMPUTER_SOFTWARE", "EDUCATION_MANAGEMENT") — read them off the facets and pass them EXACTLY, never a friendly paraphrase like "education". For people use get_hubspot_contacts; for pipeline use get_hubspot_deals. ${FRESHNESS} ${HONESTY}`,
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
    getHubspotContactsTool(ctx),
    getHubspotDealsTool(ctx),
    getHubspotCompaniesTool(ctx),
  ];
}
