/**
 * Apollo PEOPLE tools — who exists, and what we know about them.
 *
 *   - `apollo_search_people`: net-new prospecting across Apollo's database.
 *     Free, and returns NO contact details: Apollo sends availability flags,
 *     and this tool reports them as availability, never as an address.
 *   - `apollo_enrich`: one person, revealed. Ported from the existing toolkit
 *     with its contract preserved, plus two upgrades that Motion 06 asked for
 *     — employment history is a first-class field ("the personalization source
 *     of record"), and `email_status` rides along so only verified addresses
 *     are treated as real.
 *   - `apollo_bulk_enrich`: the same, batched, reporting records-in / matched
 *     / missed so the spend is auditable from the transcript.
 *
 * Search and enrich are two deliberate steps. The first costs nothing and the
 * second costs a credit per revealed email, so nothing here ever enriches a
 * search result set to see what is in it.
 */

import type { RuntimeContext } from '../types';
import type { ApolloClient } from '@/libs/apollo/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { APOLLO_ABSENCE, APOLLO_CREDITS, APOLLO_ROUTING, apolloClientForCtx } from './apolloDirect';
import { asJson, clampLimit } from './hubspotDirect';

/** Apollo caps a page at 100, and stops paging entirely after page 500. */
const MAX_PER_PAGE = 100;
const MAX_PAGE = 500;

/** How many records Apollo's bulk_match accepts in one call. */
const BULK_MATCH_CHUNK = 10;

type ApolloOrg = {
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  organization_revenue?: number;
  annual_revenue?: number;
  latest_funding_stage?: string;
  funding_stage?: string;
  technology_names?: string[];
};

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  phone?: string;
  sanitized_phone?: string;
  linkedin_url?: string;
  twitter_url?: string;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments?: string[];
  employment_history?: Array<Record<string, unknown>>;
  intent_signals?: unknown[];
  has_email?: boolean;
  email_true?: boolean;
  has_direct_phone?: boolean;
  organization?: ApolloOrg;
  account?: ApolloOrg;
};

type PeopleSearchBody = {
  people?: ApolloPerson[];
  contacts?: ApolloPerson[];
  pagination?: { page?: number; per_page?: number; total_entries?: number; total_pages?: number };
};

type MatchBody = { person?: ApolloPerson };
type BulkMatchBody = { matches?: Array<ApolloPerson | null>; status?: string };

/**
 * The host part of a website URL, without `www.`.
 * @param url
 */
function domainFromWebsite(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  const host = url.split('//').pop()?.split('/')[0] ?? '';
  return host.replace(/^www\./, '') || null;
}

/**
 * Flatten an Apollo person into the canonical contact shape the existing
 * toolkit returned, so a caller that consumed the old `apollo_enrich` still
 * finds every field where it was.
 * @param person - One person record straight from Apollo.
 */
export function normalizePerson(person: ApolloPerson): Record<string, unknown> {
  const org = person.organization ?? person.account ?? {};
  const revenue = org.organization_revenue ?? org.annual_revenue ?? null;
  return {
    first_name: person.first_name ?? null,
    last_name: person.last_name ?? null,
    email: person.email ?? null,
    // Apollo's own verdict on the address. An unverified one is a guess, and a
    // guess sent to a real person bounces onto the domain's reputation.
    email_status: person.email_status ?? null,
    email_verified: person.email_status === 'verified',
    title: person.title ?? null,
    company: org.name ?? null,
    phone: person.phone ?? person.sanitized_phone ?? null,
    linkedin_url: person.linkedin_url ?? null,
    twitter_url: person.twitter_url ?? null,
    city: person.city ?? null,
    state: person.state ?? null,
    country: person.country ?? null,
    seniority: person.seniority ?? null,
    departments: person.departments ?? [],
    // Promoted to a first-class field: it is what a personalized opener is
    // actually built from, and it was buried in the raw payload before.
    employment_history: person.employment_history ?? [],
    company_domain: org.primary_domain ?? domainFromWebsite(org.website_url),
    company_employees: org.estimated_num_employees ?? null,
    company_industry: org.industry ?? null,
    company_revenue: revenue,
    company_funding_stage: org.latest_funding_stage ?? org.funding_stage ?? null,
    company_tech_stack: org.technology_names ?? [],
    intent_signals: person.intent_signals ?? [],
  };
}

/**
 * A search row: who this is and what Apollo HOLDS for them, never the contact
 * details themselves. Search returns no address, and reporting `has_email` as
 * anything but availability would invent one.
 * @param person - One person record from a search response.
 */
export function searchRow(person: ApolloPerson): Record<string, unknown> {
  const org = person.organization ?? person.account ?? {};
  return {
    id: person.id ?? null,
    name: person.name ?? ([person.first_name, person.last_name].filter(Boolean).join(' ') || null),
    title: person.title ?? null,
    seniority: person.seniority ?? null,
    company: org.name ?? null,
    company_domain: org.primary_domain ?? domainFromWebsite(org.website_url),
    company_employees: org.estimated_num_employees ?? null,
    location: [person.city, person.state, person.country].filter(Boolean).join(', ') || null,
    linkedin_url: person.linkedin_url ?? null,
    // Availability, not an address. Apollo does not send contact details on a
    // search at any tier; `apollo_enrich` is the only thing that reveals one.
    email_available: person.has_email === true || person.email_true === true,
    direct_phone_available: person.has_direct_phone === true,
  };
}

/** The one line every search response carries about what it did NOT return. */
const NO_CONTACT_DETAILS = 'Apollo search returns NO email addresses or phone numbers at any tier. `email_available` means Apollo HOLDS an address for this person, not that we know it. Getting the address is a separate apollo_enrich call that spends a credit.';

export function apolloSearchPeopleTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const a = args as {
        titles?: string[];
        seniorities?: string[];
        person_locations?: string[];
        organization_locations?: string[];
        organization_domains?: string[];
        organization_num_employees_ranges?: string[];
        technologies?: string[];
        keywords?: string;
        page?: number;
        limit?: number;
      };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const perPage = clampLimit(a.limit, 25, MAX_PER_PAGE);
      const page = Math.max(1, Math.min(Math.trunc(a.page ?? 1) || 1, MAX_PAGE));
      const body: Record<string, unknown> = { page, per_page: perPage };
      if (a.titles?.length) {
        body.person_titles = a.titles;
      }
      if (a.seniorities?.length) {
        body.person_seniorities = a.seniorities;
      }
      if (a.person_locations?.length) {
        body.person_locations = a.person_locations;
      }
      if (a.organization_locations?.length) {
        body.organization_locations = a.organization_locations;
      }
      if (a.organization_domains?.length) {
        body.q_organization_domains_list = a.organization_domains;
      }
      if (a.organization_num_employees_ranges?.length) {
        body.organization_num_employees_ranges = a.organization_num_employees_ranges;
      }
      if (a.technologies?.length) {
        body.currently_using_any_of_technology_uids = a.technologies;
      }
      if (a.keywords) {
        body.q_keywords = a.keywords;
      }

      const res = await resolved.client.post<PeopleSearchBody>('/api/v1/mixed_people/api_search', body);
      if (!res.ok) {
        return asJson(res);
      }
      const rows = (res.data.people ?? res.data.contacts ?? []).map(searchRow);
      const total = res.data.pagination?.total_entries ?? rows.length;
      const totalPages = res.data.pagination?.total_pages ?? 1;
      const beyondDisplayCap = totalPages > MAX_PAGE;
      return asJson({
        ok: true,
        source: 'apollo_live',
        credits_spent: 0,
        total,
        returned: rows.length,
        page,
        has_more: page < Math.min(totalPages, MAX_PAGE),
        note: `Report the TOTAL (${total}), not the page size (${rows.length}). ${NO_CONTACT_DETAILS}`,
        ...(beyondDisplayCap
          ? { truncation: `Apollo pages this search 100 at a time and stops at page ${MAX_PAGE}, so at most ${MAX_PAGE * MAX_PER_PAGE} of the ${total} matches can be walked. Narrow the filters to see the rest.` }
          : {}),
        ...(rows.length === 0 ? { absence: APOLLO_ABSENCE } : {}),
        people: rows,
      });
    },
    {
      name: 'apollo_search_people',
      description: `Searches Apollo LIVE for NET-NEW people we do not already have: filter by title, seniority, location, company size, company domain, technology or keyword. FREE, 0 credits. Returns no email addresses and no phone numbers — only \`email_available\` / \`direct_phone_available\`, meaning Apollo holds one. Revealing an address is a separate apollo_enrich call. This is the entry point for prospecting; feed a shortlist a human picked into apollo_enrich, and stage what is worth keeping with apollo_add_to_list. ${APOLLO_ROUTING} ${APOLLO_ABSENCE}`,
      schema: z.object({
        titles: z.array(z.string()).optional().describe('Job titles to match, e.g. ["VP Marketing", "Head of Growth"]. Apollo matches loosely, so list the variants you mean.'),
        seniorities: z.array(z.string()).optional().describe('Apollo seniority bands: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern.'),
        person_locations: z.array(z.string()).optional().describe('Where the PERSON is, e.g. ["Colorado, US"].'),
        organization_locations: z.array(z.string()).optional().describe('Where their COMPANY is headquartered.'),
        organization_domains: z.array(z.string()).optional().describe('Restrict to these company domains, e.g. ["acme.com"]. Use for "who works at X".'),
        organization_num_employees_ranges: z.array(z.string()).optional().describe('Employee-count bands, exactly as Apollo spells them: ["1,10"], ["11,50"], ["51,200"], ["201,500"], ["501,1000"], ["1001,5000"].'),
        technologies: z.array(z.string()).optional().describe('Technology uids the company currently uses, e.g. ["hubspot"].'),
        keywords: z.string().optional().describe('Free-text keywords matched across the person and their company.'),
        page: z.number().int().positive().optional().describe(`Page to fetch (default 1, max ${MAX_PAGE}).`),
        limit: z.number().int().positive().optional().describe(`People per page (default 25, max ${MAX_PER_PAGE}). Does NOT limit \`total\`.`),
      }),
    },
  );
}

/**
 * The match body for one contact. Email is the strongest signal; name and
 * company narrow an ambiguous match rather than replacing it.
 * @param contact - What the caller knows about the person.
 */
function matchBody(contact: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const copy = (from: string, to: string) => {
    const value = contact[from];
    if (typeof value === 'string' && value.trim() !== '') {
      body[to] = value.trim();
    }
  };
  copy('email', 'email');
  copy('first_name', 'first_name');
  copy('last_name', 'last_name');
  copy('name', 'name');
  copy('company', 'organization_name');
  copy('company_domain', 'domain');
  copy('linkedin_url', 'linkedin_url');
  return body;
}

/**
 * Reveal one person through Apollo's match endpoint.
 * @param client - The resolved Apollo client.
 * @param contact - What we know about them going in.
 */
async function enrichOne(client: ApolloClient, contact: Record<string, unknown>) {
  return client.post<MatchBody>('/api/v1/people/match', matchBody(contact));
}

export function apolloEnrichTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { contact } = args as { contact: Record<string, unknown> };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const body = matchBody(contact ?? {});
      if (Object.keys(body).length === 0) {
        return asJson({
          ok: false,
          error: 'bad_argument',
          message: 'apollo_enrich needs something to match on: an email at minimum, or a name plus a company or domain.',
        });
      }
      const res = await enrichOne(resolved.client, contact ?? {});
      if (!res.ok) {
        return asJson(res);
      }
      const person = res.data.person;
      if (!person) {
        return asJson({
          ok: true,
          source: 'apollo_live',
          contact: null,
          reason: 'no_match',
          credits_spent: 0,
          message: `Apollo has no match for ${JSON.stringify(body)}. That is an absence in Apollo, not proof the person does not exist.`,
        });
      }
      const enriched = normalizePerson(person);
      return asJson({
        ok: true,
        source: 'apollo_live',
        credits_spent: enriched.email ? 1 : 0,
        contact: enriched,
        fields: Object.entries(enriched).map(([key, value]) => ({ key, value })),
        ...(enriched.email && !enriched.email_verified
          ? { warning: `Apollo returned this address with email_status "${enriched.email_status}", which is NOT verified. Say so before anyone sends to it.` }
          : {}),
      });
    },
    {
      name: 'apollo_enrich',
      description: `Reveals ONE person through Apollo: verified work email, direct phone, title, seniority, and employment_history — the career record a personalized opener is actually built from. Pass an email at minimum; a name plus company or domain also matches. Costs roughly 1 credit per revealed email and 8 per phone, so enrich a shortlist a human picked, never a whole search result. \`email_status\` is Apollo's own verdict: treat anything but "verified" as unconfirmed and say so. ${APOLLO_CREDITS} ${APOLLO_ROUTING}`,
      schema: z.object({
        contact: z.record(z.string(), z.unknown()).describe('What is known about the person: { email }, or { first_name, last_name, company } / { name, company_domain }. Extra keys are ignored.'),
      }),
    },
  );
}

export function apolloBulkEnrichTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { contacts } = args as { contacts: Array<Record<string, unknown>> };
      const resolved = await apolloClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const list = Array.isArray(contacts) ? contacts : [];
      if (list.length === 0) {
        return asJson({ ok: false, error: 'bad_argument', message: 'apollo_bulk_enrich needs at least one contact to match on.' });
      }
      const details = list.map(matchBody);
      const results: Array<Record<string, unknown> | null> = [];
      // Apollo takes ten per call; the batching is this tool's job so the
      // model never has to know the limit or page around it.
      for (let start = 0; start < details.length; start += BULK_MATCH_CHUNK) {
        const chunk = details.slice(start, start + BULK_MATCH_CHUNK);
        const res = await resolved.client.post<BulkMatchBody>('/api/v1/people/bulk_match', { details: chunk });
        if (!res.ok) {
          return asJson({
            ...res,
            matched_before_failure: results.filter(Boolean).length,
            message: `${(res as { message: string }).message} ${results.filter(Boolean).length} of ${details.length} record(s) had already been enriched when this failed.`,
          });
        }
        const matches = res.data.matches ?? [];
        for (let index = 0; index < chunk.length; index += 1) {
          const person = matches[index];
          results.push(person ? normalizePerson(person) : null);
        }
      }
      const matched = results.filter(Boolean) as Array<Record<string, unknown>>;
      const missed = list
        .map((contact, index) => (results[index] ? null : (contact.email ?? contact.name ?? `record ${index + 1}`)))
        .filter(Boolean);
      return asJson({
        ok: true,
        source: 'apollo_live',
        records_in: list.length,
        matched: matched.length,
        missed: missed.length,
        // Named, not just counted: "3 missed" is unactionable, three addresses
        // is a list someone can look at.
        missed_records: missed,
        credits_spent: matched.filter(row => row.email).length,
        unverified: matched.filter(row => row.email && !row.email_verified).length,
        contacts: results,
      });
    },
    {
      name: 'apollo_bulk_enrich',
      description: `Enriches SEVERAL people in one go (Apollo takes 10 per call; this batches larger lists for you). Reports records-in / matched / missed and names what missed, so the spend and the gaps are both auditable from this transcript. Same cost as apollo_enrich per revealed record. Use after a human has picked the shortlist. ${APOLLO_CREDITS} ${APOLLO_ROUTING}`,
      schema: z.object({
        contacts: z.array(z.record(z.string(), z.unknown())).min(1).describe('One dict per person, each shaped like apollo_enrich\'s `contact`.'),
      }),
    },
  );
}

/**
 * The people tools, source-gated as a set.
 * @param ctx
 */
export function apolloPeopleTools(ctx: RuntimeContext) {
  return [
    apolloSearchPeopleTool(ctx),
    apolloEnrichTool(ctx),
    apolloBulkEnrichTool(ctx),
  ];
}
