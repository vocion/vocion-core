/**
 * Apollo COMPANY tools — accounts that exist, and what is knowable about them.
 *
 *   - `apollo_search_companies`: account-level prospecting. PAID TIER ONLY and
 *     billed per page, so every response states the credit it just spent and a
 *     403 reads as a plan fact rather than a bug.
 *   - `apollo_enrich_company`: domain to firmographics, one or many. Modeled
 *     fields are LABELLED, which is what makes "never quote an estimate back to
 *     the company" enforceable instead of aspirational.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { APOLLO_ABSENCE, APOLLO_CREDITS, APOLLO_ROUTING, apolloClientForCtx } from './apolloDirect';
import { asJson, clampLimit } from './hubspotDirect';

const MAX_PER_PAGE = 100;
/** Apollo's own cap on the domain list a company search may carry. */
const MAX_DOMAINS = 1000;
/** What one page of company search costs. */
const CREDITS_PER_PAGE = 1;

type ApolloOrganization = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  organization_revenue?: number;
  annual_revenue?: number;
  annual_revenue_printed?: string;
  latest_funding_stage?: string;
  latest_funding_round_date?: string;
  total_funding?: number;
  technology_names?: string[];
  keywords?: string[];
  city?: string;
  state?: string;
  country?: string;
  short_description?: string;
  linkedin_url?: string;
};

type CompanySearchBody = {
  organizations?: ApolloOrganization[];
  accounts?: ApolloOrganization[];
  pagination?: { page?: number; per_page?: number; total_entries?: number; total_pages?: number };
};

type EnrichBody = { organization?: ApolloOrganization; organizations?: ApolloOrganization[] };

/**
 * Fields Apollo MODELS rather than observes. Estimated headcount and estimated
 * revenue are inferences, and quoting one back to the company it is about is
 * how a brief loses its credibility in one line.
 */
const MODELED_FIELDS = ['employees', 'revenue'] as const;

/**
 * One company, with the modeled fields flagged as modeled.
 * @param org - One organization record from Apollo.
 */
export function companyRow(org: ApolloOrganization): Record<string, unknown> {
  const revenue = org.organization_revenue ?? org.annual_revenue ?? null;
  return {
    id: org.id ?? null,
    name: org.name ?? null,
    domain: org.primary_domain ?? (org.website_url ?? '').split('//').pop()?.split('/')[0]?.replace(/^www\./, '') ?? null,
    industry: org.industry ?? null,
    employees: org.estimated_num_employees ?? null,
    revenue,
    revenue_printed: org.annual_revenue_printed ?? null,
    funding_stage: org.latest_funding_stage ?? null,
    last_funding_date: org.latest_funding_round_date ?? null,
    total_funding: org.total_funding ?? null,
    technologies: org.technology_names ?? [],
    keywords: org.keywords ?? [],
    location: [org.city, org.state, org.country].filter(Boolean).join(', ') || null,
    description: org.short_description ?? null,
    linkedin_url: org.linkedin_url ?? null,
    // Machine-readable, so a downstream grounding check can enforce the rule
    // rather than trusting a prompt to remember it.
    modeled: MODELED_FIELDS.filter(field => field === 'employees' ? org.estimated_num_employees != null : revenue != null),
  };
}

const MODELED_NOTE = 'Fields named in `modeled` are Apollo ESTIMATES, not facts the company published. Never quote one back to the company it describes, and label it as an estimate anywhere else.';

export function apolloSearchCompaniesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const a = args as {
        domains?: string[];
        organization_locations?: string[];
        num_employees_ranges?: string[];
        revenue_min?: number;
        revenue_max?: number;
        technologies?: string[];
        keywords?: string;
        name?: string;
        page?: number;
        limit?: number;
      };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const perPage = clampLimit(a.limit, 25, MAX_PER_PAGE);
      const page = Math.max(1, Math.trunc(a.page ?? 1) || 1);
      const domains = (a.domains ?? []).slice(0, MAX_DOMAINS);
      const body: Record<string, unknown> = { page, per_page: perPage };
      if (domains.length > 0) {
        body.q_organization_domains_list = domains;
      }
      if (a.organization_locations?.length) {
        body.organization_locations = a.organization_locations;
      }
      if (a.num_employees_ranges?.length) {
        body.organization_num_employees_ranges = a.num_employees_ranges;
      }
      if (a.revenue_min !== undefined) {
        body.revenue_range = { min: a.revenue_min, ...(a.revenue_max === undefined ? {} : { max: a.revenue_max }) };
      } else if (a.revenue_max !== undefined) {
        body.revenue_range = { max: a.revenue_max };
      }
      if (a.technologies?.length) {
        body.currently_using_any_of_technology_uids = a.technologies;
      }
      if (a.keywords) {
        body.q_organization_keyword_tags = [a.keywords];
      }
      if (a.name) {
        body.q_organization_name = a.name;
      }

      const res = await resolved.client.post<CompanySearchBody>('/api/v1/mixed_companies/search', body);
      if (!res.ok) {
        // A closed plan tier is already named `plan_tier_unavailable` by the
        // client. Passing it through unchanged is the whole point: the model
        // reports a plan limit instead of retrying into a wall.
        return asJson(res);
      }
      const rows = (res.data.organizations ?? res.data.accounts ?? []).map(companyRow);
      const total = res.data.pagination?.total_entries ?? rows.length;
      const totalPages = res.data.pagination?.total_pages ?? 1;
      return asJson({
        ok: true,
        source: 'apollo_live',
        // Stated every time, so a paging loop is visible spend rather than
        // silent spend.
        credits_spent: CREDITS_PER_PAGE,
        total,
        returned: rows.length,
        page,
        has_more: page < totalPages,
        note: `Report the TOTAL (${total}), not the page size (${rows.length}). This page cost ${CREDITS_PER_PAGE} Apollo credit, and every further page costs another. ${MODELED_NOTE}`,
        ...(domains.length === MAX_DOMAINS ? { truncation: `Only the first ${MAX_DOMAINS} domains were searched; Apollo accepts no more in one call.` } : {}),
        ...(rows.length === 0 ? { absence: APOLLO_ABSENCE } : {}),
        companies: rows,
      });
    },
    {
      name: 'apollo_search_companies',
      description: `Searches Apollo LIVE for COMPANIES (accounts) by domain, location, size, revenue, technology, keyword or name. COSTS 1 APOLLO CREDIT PER PAGE — the response says so every time, so page deliberately and narrow the filters instead of walking pages. PAID TIER ONLY: if this workspace's Apollo plan does not include it the tool returns \`plan_tier_unavailable\`, which is a plan limit to report, not an error to retry. For the people at a company, use apollo_search_people with organization_domains. ${APOLLO_CREDITS} ${APOLLO_ROUTING} ${APOLLO_ABSENCE}`,
      schema: z.object({
        domains: z.array(z.string()).optional().describe(`Company domains to match, e.g. ["acme.com"] (max ${MAX_DOMAINS}).`),
        organization_locations: z.array(z.string()).optional().describe('Headquarters locations, e.g. ["Colorado, US"].'),
        num_employees_ranges: z.array(z.string()).optional().describe('Employee bands exactly as Apollo spells them: ["1,10"], ["11,50"], ["51,200"], ["201,500"].'),
        revenue_min: z.number().optional().describe('Minimum annual revenue in dollars.'),
        revenue_max: z.number().optional().describe('Maximum annual revenue in dollars.'),
        technologies: z.array(z.string()).optional().describe('Technology uids the company currently uses, e.g. ["hubspot"].'),
        keywords: z.string().optional().describe('Keyword tag matched against the company.'),
        name: z.string().optional().describe('Company name fragment.'),
        page: z.number().int().positive().optional().describe('Page to fetch (default 1). EACH page costs a credit.'),
        limit: z.number().int().positive().optional().describe(`Companies per page (default 25, max ${MAX_PER_PAGE}).`),
      }),
    },
  );
}

export function apolloEnrichCompanyTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { domains } = args as { domains: string[] };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const list = (Array.isArray(domains) ? domains : [])
        .map(domain => String(domain).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? '')
        .filter(domain => domain !== '');
      if (list.length === 0) {
        return asJson({ ok: false, error: 'bad_argument', message: 'apollo_enrich_company needs at least one company domain.' });
      }

      // One domain rides the single endpoint; several ride the bulk one. Same
      // tool either way, because "enrich these five accounts" is one intent.
      const res = list.length === 1
        ? await resolved.client.post<EnrichBody>('/api/v1/organizations/enrich', { domain: list[0] })
        : await resolved.client.post<EnrichBody>('/api/v1/organizations/bulk_enrich', { domains: list });
      if (!res.ok) {
        return asJson(res);
      }
      const found = res.data.organizations ?? (res.data.organization ? [res.data.organization] : []);
      const rows = found.map(companyRow);
      const matchedDomains = new Set(rows.map(row => row.domain));
      const missed = list.filter(domain => !matchedDomains.has(domain));
      return asJson({
        ok: true,
        source: 'apollo_live',
        domains_in: list.length,
        matched: rows.length,
        missed: missed.length,
        missed_domains: missed,
        note: MODELED_NOTE,
        companies: rows,
      });
    },
    {
      name: 'apollo_enrich_company',
      description: `Enriches ONE OR MORE companies from their domains: size, revenue, funding, technology stack, keywords, description. Credit-consuming. Estimated headcount and estimated revenue come back flagged in \`modeled\` — they are Apollo's inferences, so never quote one back to the company it describes. Reports which domains matched and which did not. ${APOLLO_CREDITS} ${APOLLO_ROUTING}`,
      schema: z.object({
        domains: z.array(z.string()).min(1).describe('Company domains, e.g. ["acme.com", "example.io"]. A full URL is accepted and trimmed to its host.'),
      }),
    },
  );
}

/**
 * The company tools, source-gated as a set.
 * @param ctx
 */
export function apolloCompanyTools(ctx: RuntimeContext) {
  return [apolloSearchCompaniesTool(ctx), apolloEnrichCompanyTool(ctx)];
}
