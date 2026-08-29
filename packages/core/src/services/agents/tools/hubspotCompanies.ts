/**
 * Direct-to-HubSpot COMPANY tools — the account-history chain the mirror
 * cannot run: find the company by name → list its deals INCLUDING the
 * closed-lost one with its loss reason → read the activity timeline.
 *
 *   - `hubspot_search_companies`: name/domain lookup, de-spaced variant +
 *     broaden-once ("Terra Clear" also matches "TerraClear").
 *   - `hubspot_get_company`: one account's firmographics.
 *   - `hubspot_company_deals`: every deal on the account, closed included,
 *     with `loss_reason` on closed-lost rows.
 *   - `hubspot_company_activity` (Phase 3): notes/emails/meetings/calls as
 *     one newest-first timeline.
 */

import type { RuntimeContext } from '../types';
import type { HubspotClient, HubspotPage, HubspotRecord, StageInfo } from '@/libs/hubspot/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { asJson, clampLimit, distinctiveTokens, hubspotClientForCtx } from './hubspotDirect';

/** Firmographics read off a company object — what grounds an account brief. */
export const COMPANY_PROPS = [
  'name',
  'domain',
  'industry',
  'lifecyclestage',
  'annualrevenue',
  'numberofemployees',
  'city',
  'state',
  'country',
  'description',
  'hubspot_owner_id',
];

/**
 * Deal properties for the company's deal list — BOTH closed-lost reason
 * fields (reps fill one or the other; `combineLossReason` merges them).
 */
const COMPANY_DEAL_PROPS = [
  'dealname',
  'dealstage',
  'pipeline',
  'amount',
  'closedate',
  'closed_lost_reason',
  'closed_lost_reason_dropdown',
];

type Props = Record<string, string | null>;

/**
 * Normalize a company's property bag into the shape every tool returns.
 * @param id
 * @param props
 */
export function companyRow(id: string | undefined, props: Props): Record<string, unknown> {
  const location = [props.city, props.state, props.country].filter(Boolean).join(', ') || null;
  return {
    id: id ?? null,
    name: props.name ?? null,
    domain: props.domain ?? null,
    industry: props.industry ?? null,
    lifecycle_stage: props.lifecyclestage ?? null,
    revenue: props.annualrevenue ?? null,
    employees: props.numberofemployees ?? null,
    location,
    description: props.description ?? null,
  };
}

/**
 * Best "why we lost" from a deal's properties: the dropdown category
 * ("Closed lost reason") and the free-text details combined. Either may be
 * blank; a 1-2 char value is a placeholder, not a reason. Falls back to the
 * stage label when neither is recorded.
 * @param props
 * @param stageLabel
 */
export function combineLossReason(props: Props, stageLabel: string | undefined): string | null {
  const category = (props.closed_lost_reason_dropdown ?? '').trim();
  let details = (props.closed_lost_reason ?? '').trim();
  if (details.length < 3) {
    details = '';
  }
  const parts = [category, details].filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : stageLabel ?? null;
}

/**
 * One CONTAINS_TOKEN search over name + domain per variant (groups are OR'd;
 * at most 2 variants keeps us under HubSpot's 5-filter-group cap).
 * @param client
 * @param variants
 * @param limit
 */
async function companySearch(client: HubspotClient, variants: string[], limit: number) {
  const filterGroups = variants.slice(0, 2).flatMap(variant => [
    { filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: variant }] },
    { filters: [{ propertyName: 'domain', operator: 'CONTAINS_TOKEN', value: variant }] },
  ]);
  return client.post<HubspotPage>('/crm/v3/objects/companies/search', {
    limit,
    properties: COMPANY_PROPS,
    filterGroups,
  });
}

export function hubspotSearchCompaniesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { name, limit } = args as { name: string; limit?: number };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const query = (name ?? '').trim();
      if (!query) {
        return asJson({ ok: false, error: 'bad_argument', message: 'name is required (a company name or domain fragment).' });
      }
      const cap = clampLimit(limit, 5, 25);
      // CONTAINS_TOKEN AND-matches a query's tokens, so a spaced query
      // ("Terra Clear") won't match a single-token name ("TerraClear").
      // Search the query AND its de-spaced variant in one call.
      const variants = [...new Set([query, query.replaceAll(' ', '')])].filter(Boolean);
      let broadened = false;
      let res = await companySearch(resolved.client, variants, cap);
      if (res.ok && (res.data.results ?? []).length === 0) {
        // A multi-word miss often carries words the CRM name omits ("Acme
        // Holdings Inc" vs an "Acme" record). Broaden ONCE to the most
        // distinctive token before concluding the account is not in HubSpot.
        const tokens = distinctiveTokens(query);
        if (tokens.length > 1) {
          broadened = true;
          res = await companySearch(resolved.client, [tokens[0]!], cap);
        }
      }
      if (!res.ok) {
        return asJson(res);
      }
      const companies = (res.data.results ?? []).map((row: HubspotRecord) => companyRow(row.id, row.properties ?? {}));
      return asJson({
        ok: true,
        source: 'hubspot_live',
        query,
        count: companies.length,
        broadened,
        ...(companies.length === 0
          ? { retry_hint: `No HubSpot company matched "${query}"${broadened ? ' even after broadening to the most distinctive word' : ''}. Try a shorter or partial name, a domain fragment, or a different spelling before concluding the account is not in HubSpot.` }
          : {}),
        companies,
      });
    },
    {
      name: 'hubspot_search_companies',
      description: 'Reads HubSpot LIVE, current as of this call: find a COMPANY (account) by name or domain — the entry point for any account-level question ("what happened with X", "why did we lose X"). A spaced query is also searched de-spaced ("Terra Clear" matches "TerraClear"), and a multi-word miss broadens ONCE to its most distinctive word (broadened: true). Feed the returned id into hubspot_get_company / hubspot_company_deals / hubspot_company_activity. Routing: people (not accounts) → hubspot_search_contacts; "how many companies / by industry" → hubspot_count_companies on the synced mirror.',
      schema: z.object({
        name: z.string().min(1).describe('Company name or domain fragment (token-matched on both name and domain).'),
        limit: z.number().int().positive().optional().describe('Max companies to return (default 5, max 25).'),
      }),
    },
  );
}

export function hubspotGetCompanyTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { company_id } = args as { company_id: string };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const res = await resolved.client.get<HubspotRecord>(`/crm/v3/objects/companies/${company_id}`, {
        properties: COMPANY_PROPS.join(','),
      });
      if (!res.ok) {
        if (res.error === 'hubspot_error' && res.status === 404) {
          return asJson({
            ok: true,
            company: null,
            reason: 'no_match',
            company_id,
            message: `HubSpot has no company with id "${company_id}".`,
            retry_hint: 'Find the id with hubspot_search_companies (name or domain) first.',
          });
        }
        return asJson(res);
      }
      return asJson({
        ok: true,
        source: 'hubspot_live',
        company: companyRow(res.data.id ?? company_id, res.data.properties ?? {}),
      });
    },
    {
      name: 'hubspot_get_company',
      description: 'Reads HubSpot LIVE, current as of this call: ONE company\'s record + firmographics by id — domain, industry, lifecycle stage, revenue, employee count, location, description. Get the id from hubspot_search_companies. Routing: the account\'s deals (including lost ones and why) → hubspot_company_deals; what was discussed → hubspot_company_activity; "how many companies" → hubspot_count_companies on the synced mirror.',
      schema: z.object({
        company_id: z.string().min(1).describe('HubSpot company id (numeric string), from hubspot_search_companies.'),
      }),
    },
  );
}

export function hubspotCompanyDealsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { company_id, limit } = args as { company_id: string; limit?: number };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const cap = clampLimit(limit, 25, 100);
      const assoc = await resolved.client.get<HubspotRecord>(`/crm/v3/objects/companies/${company_id}`, {
        associations: 'deals',
      });
      if (!assoc.ok) {
        if (assoc.error === 'hubspot_error' && assoc.status === 404) {
          return asJson({ ok: true, count: 0, deals: [], reason: 'no_match', message: `HubSpot has no company with id "${company_id}".` });
        }
        return asJson(assoc);
      }
      const dealIds = (assoc.data.associations?.deals?.results ?? [])
        .map(r => String(r.id ?? ''))
        .filter(Boolean)
        .slice(0, cap);
      if (dealIds.length === 0) {
        return asJson({ ok: true, source: 'hubspot_live', company_id, count: 0, deals: [] });
      }

      // Stage labels + closed-ness across ALL pipelines; without them a lost
      // deal cannot be told from an open one, so a failure here is a failure.
      const stagesRes = await resolved.client.fetchDealStages();
      if (!stagesRes.ok) {
        return asJson(stagesRes);
      }
      const stages = stagesRes.data;

      const read = await resolved.client.post<HubspotPage>('/crm/v3/objects/deals/batch/read', {
        properties: COMPANY_DEAL_PROPS,
        inputs: dealIds.map(id => ({ id })),
      });
      if (!read.ok) {
        return asJson(read);
      }
      const deals = (read.data.results ?? []).map((row) => {
        const p = row.properties ?? {};
        const stage: StageInfo | undefined = p.dealstage ? stages.get(p.dealstage) : undefined;
        const stageLabel = stage?.label ?? p.dealstage ?? null;
        const isClosed = stage?.isClosed ?? false;
        const isWon = isClosed && (stageLabel ?? '').toLowerCase().includes('won');
        return {
          deal_id: row.id,
          name: p.dealname ?? null,
          stage: stageLabel,
          stage_id: p.dealstage ?? null,
          pipeline: stage?.pipelineLabel ?? p.pipeline ?? null,
          amount: p.amount ?? null,
          closedate: p.closedate ?? null,
          is_closed: isClosed,
          is_won: isWon,
          loss_reason: isClosed && !isWon ? combineLossReason(p, stage?.label) : null,
        };
      });
      // Newest-closed first; deals without a closedate (still open) sort last.
      deals.sort((a, b) => (b.closedate ?? '').localeCompare(a.closedate ?? ''));
      return asJson({
        ok: true,
        source: 'hubspot_live',
        company_id,
        count: deals.length,
        deals,
      });
    },
    {
      name: 'hubspot_company_deals',
      description: 'Reads HubSpot LIVE, current as of this call: EVERY deal on one company — INCLUDING closed-won and closed-lost — newest-closed first, each tagged is_closed / is_won, with loss_reason (the "Closed lost reason" category + free-text details combined) on closed-lost rows. This is the tool for "why did we lose X": hubspot_list_deals deliberately EXCLUDES closed deals, and the hubspot_count_deals mirror carries no loss reasons. Get the company id from hubspot_search_companies. Default 25 deals, max 100.',
      schema: z.object({
        company_id: z.string().min(1).describe('HubSpot company id (numeric string), from hubspot_search_companies.'),
        limit: z.number().int().positive().optional().describe('Max deals to return (default 25, max 100).'),
      }),
    },
  );
}

export function hubspotCompanyTools(ctx: RuntimeContext) {
  return [
    hubspotSearchCompaniesTool(ctx),
    hubspotGetCompanyTool(ctx),
    hubspotCompanyDealsTool(ctx),
  ];
}
