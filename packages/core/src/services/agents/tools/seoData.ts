/**
 * SEO data a client already has, read live — beside the SERP tools, in the
 * same `serp` grant (`docs/guides/seo-data.md`):
 *
 *   - `search_console_queries` / `search_console_pages` — Google Search
 *     Console: what the client's site already ranks for and what its pages
 *     get, in clicks, impressions, CTR and position. Free; the property is
 *     the client Project's (`services/seo/searchConsole.ts`).
 *   - `ahrefs_organic_keywords` / `ahrefs_brand_radar` — the workspace's own
 *     Ahrefs: the keywords a domain ranks for, and the AI answers that
 *     mention a brand.
 *
 * None of them blocks research: with nothing connected each says so in a
 * sentence (which shows the connect card, `connectCardOnGap.ts`) and the
 * SERP tools carry on. Everything heavy is imported on first call.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { SearchConsoleDimension, SearchConsoleFilter } from '@/libs/searchConsole/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** The grant these ride in: the SERP tools' (`serpResearch.ts` `SERP_GRANT`), spelled here so this file stays light. */
const SERP_GRANT = 'serp';

export const SEO_DATA_TOOL_NAMES = ['search_console_queries', 'search_console_pages', 'ahrefs_organic_keywords', 'ahrefs_brand_radar'] as const;

const AHREFS_NOT_CONNECTED = 'Ahrefs is not connected in this workspace. A workspace admin can add the Ahrefs API key under Connectors → Ahrefs (it needs an Ahrefs plan with API access). Say it is not connected; do not estimate the numbers.';

function granted(ctx: RuntimeContext, name: string): boolean {
  const grants = ctx.harnessConfig.grantTools ?? [];
  return grants.includes(SERP_GRANT) || grants.includes(name);
}

const propertyArgs = {
  project_id: z.number().int().positive().optional().describe('The client project (list_projects) whose Search Console property to read.'),
  site_url: z.string().max(300).optional().describe('The property, exactly as Search Console names it ("sc-domain:example.com" or "https://www.example.com/"). Only one the person picked: with project_id it is kept on the project for next time.'),
};

const rangeArgs = {
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; omit for the last `days`'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default two days ago (Search Console lags)'),
  days: z.number().int().min(1).max(480).optional().describe('How many days, when no dates are given (default 28)'),
};

/**
 * The property to read and the token to read it with, or the sentence that
 * says why not (not connected; no property picked, with the choices).
 * @param ctx - The turn.
 * @param args - What the call named.
 * @param args.project_id - The client project.
 * @param args.site_url - A property the person picked.
 */
async function resolveProperty(ctx: RuntimeContext, args: { project_id?: number; site_url?: string }): Promise<{ ok: true; accessToken: string; siteUrl: string; kept?: string } | { ok: false; text: string }> {
  const sc = await import('@/services/seo/searchConsole');
  const access = await sc.searchConsoleAccess(ctx.orgId);
  if (!access.ok) {
    return { ok: false, text: access.reason };
  }
  const asked = args.site_url?.trim();
  if (asked) {
    const { sites, reason } = await sc.searchConsoleSites(ctx.orgId);
    const match = sites.find(s => s.siteUrl === asked) ?? sites.find(s => s.siteUrl.replace(/\/$/, '') === asked.replace(/\/$/, ''));
    if (!match) {
      return { ok: false, text: `${asked} is not a Search Console property this login can read. ${sites.length ? `It reads: ${sites.map(s => s.siteUrl).join(', ')}.` : reason ?? ''}`.trim() };
    }
    let kept: string | undefined;
    if (args.project_id) {
      const held = await sc.projectSearchConsoleProperty(ctx.orgId, args.project_id);
      if (held === 'no-project') {
        return { ok: false, text: `No project #${args.project_id} in this workspace.` };
      }
      if (held?.siteUrl !== match.siteUrl && await sc.setProjectSearchConsoleProperty(ctx.orgId, args.project_id, match.siteUrl, ctx.userId ?? null)) {
        kept = `Kept ${match.siteUrl} as project #${args.project_id}'s Search Console property.`;
      }
    }
    return { ok: true, accessToken: access.accessToken, siteUrl: match.siteUrl, ...(kept ? { kept } : {}) };
  }
  if (args.project_id) {
    const held = await sc.projectSearchConsoleProperty(ctx.orgId, args.project_id);
    if (held === 'no-project') {
      return { ok: false, text: `No project #${args.project_id} in this workspace.` };
    }
    if (held) {
      return { ok: true, accessToken: access.accessToken, siteUrl: held.siteUrl };
    }
  } else if (access.defaultSite) {
    return { ok: true, accessToken: access.accessToken, siteUrl: access.defaultSite };
  }
  const { sites, reason } = await sc.searchConsoleSites(ctx.orgId);
  if (sites.length === 0) {
    return { ok: false, text: reason ?? 'This Google login reads no Search Console property.' };
  }
  if (sites.length === 1 && !args.project_id) {
    return { ok: true, accessToken: access.accessToken, siteUrl: sites[0]!.siteUrl };
  }
  const { propertyLabel } = await import('@/libs/searchConsole/client');
  return {
    ok: false,
    text: JSON.stringify({
      needsProperty: true,
      properties: sites.map(s => ({ site_url: s.siteUrl, label: propertyLabel(s.siteUrl) })),
      next: `${args.project_id ? `Project #${args.project_id} has no Search Console property yet.` : 'Name the client project (project_id).'} Ask the person which property is this client's (one ask, the properties as choices; the domain property first), then call again with project_id and the site_url they picked: it is kept on the project.`,
    }),
  };
}

function filtersOf(args: { query_contains?: string; page_contains?: string; country?: string; device?: 'desktop' | 'mobile' | 'tablet' }): SearchConsoleFilter[] {
  return [
    ...(args.query_contains ? [{ dimension: 'query' as const, operator: 'contains' as const, expression: args.query_contains }] : []),
    ...(args.page_contains ? [{ dimension: 'page' as const, operator: 'contains' as const, expression: args.page_contains }] : []),
    ...(args.country ? [{ dimension: 'country' as const, operator: 'equals' as const, expression: args.country.toLowerCase() }] : []),
    ...(args.device ? [{ dimension: 'device' as const, operator: 'equals' as const, expression: args.device.toUpperCase() }] : []),
  ];
}

/**
 * Read a report and lay it out for the model: the property, the dates, the
 * rows with their keys named, and where the numbers came from.
 * @param ctx - The turn.
 * @param args - The call.
 * @param dimensions - What the rows are broken down by.
 */
async function report(ctx: RuntimeContext, args: Record<string, unknown> & { project_id?: number; site_url?: string; start_date?: string; end_date?: string; days?: number; limit?: number }, dimensions: SearchConsoleDimension[]): Promise<string> {
  const property = await resolveProperty(ctx, args);
  if (!property.ok) {
    return property.text;
  }
  const { querySearchConsole, searchConsoleRange } = await import('@/libs/searchConsole/client');
  const range = searchConsoleRange({ startDate: args.start_date, endDate: args.end_date, days: args.days });
  try {
    const r = await querySearchConsole(property.accessToken, { siteUrl: property.siteUrl, ...range, dimensions, filters: filtersOf(args as Parameters<typeof filtersOf>[0]), rowLimit: args.limit ?? 50 });
    return JSON.stringify({
      source: 'Google Search Console',
      property: r.siteUrl,
      startDate: r.startDate,
      endDate: r.endDate,
      checkedAt: new Date().toISOString(),
      rows: r.rows.map(row => ({ ...Object.fromEntries(dimensions.map((d, i) => [d, row.keys[i] ?? ''])), clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
      ...(r.rows.length === 0 ? { note: 'No rows: the site had no impressions for this in the range, or the filters matched nothing.' } : {}),
      ...(property.kept ? { kept: property.kept } : {}),
    });
  } catch (err) {
    return (err as Error).message;
  }
}

const filterArgs = {
  query_contains: z.string().max(200).optional().describe('Only queries containing this'),
  page_contains: z.string().max(300).optional().describe('Only pages whose URL contains this (a path such as "/blog/")'),
  country: z.string().length(3).optional().describe('ISO 3166-1 alpha-3, as Search Console names countries: "usa"'),
  device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
  limit: z.number().int().min(1).max(1000).optional().describe('Rows, most clicks first (default 50)'),
};

function searchConsoleQueriesTool(ctx: RuntimeContext) {
  return tool(
    async args => report(ctx, args, args.by_page ? ['query', 'page'] : ['query']),
    {
      name: 'search_console_queries',
      description: 'What the client\'s site already ranks for, from its own Google Search Console: each search query (and with by_page, the page that shows for it) with clicks, impressions, CTR (0–1) and average position over a date range. Free and real, not an estimate. Use before planning a client\'s keywords, to find what it nearly ranks for (positions 5–20 with impressions). Reads the project\'s property; with none it lists the properties to ask the person about.',
      schema: z.object({ ...propertyArgs, ...rangeArgs, by_page: z.boolean().optional().describe('Break each query down by the page that shows for it'), ...filterArgs }),
    },
  );
}

function searchConsolePagesTool(ctx: RuntimeContext) {
  return tool(
    async args => report(ctx, args, ['page']),
    {
      name: 'search_console_pages',
      description: 'How the client\'s pages do in Google search, from its own Google Search Console: each page with clicks, impressions, CTR (0–1) and average position over a date range. Use to measure pages after they are published (page_contains the path), or to find pages losing ground (compare two ranges).',
      schema: z.object({ ...propertyArgs, ...rangeArgs, ...filterArgs }),
    },
  );
}

/**
 * An Ahrefs call's failure in words: not connected, the plan refused it, or
 * the vendor failed.
 * @param err - What was thrown.
 */
async function ahrefsFailure(err: unknown): Promise<string> {
  const [{ ProviderNotConfiguredError }] = await Promise.all([import('@/libs/tools/types')]);
  if (err instanceof ProviderNotConfiguredError) {
    return AHREFS_NOT_CONNECTED;
  }
  return `${(err as Error).message ?? 'Ahrefs failed.'} Say what Ahrefs said; do not estimate the numbers.`;
}

function ahrefsOrganicKeywordsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const { ahrefsOrganicKeywords } = await import('@/libs/tools/serp/ahrefs');
        const r = await ahrefsOrganicKeywords(args.domain, { country: args.country, limit: args.limit, orgId: ctx.orgId });
        return JSON.stringify({ source: 'Ahrefs (the workspace\'s own plan)', checkedAt: new Date().toISOString(), ...r });
      } catch (err) {
        return ahrefsFailure(err);
      }
    },
    {
      name: 'ahrefs_organic_keywords',
      description: 'The keywords a domain ranks for in Google, from the workspace\'s Ahrefs: each with its best position and URL, volume, keyword difficulty, the traffic it brings and CPC, most traffic first. Use on a client\'s or a competitor\'s domain to find gaps. Needs Ahrefs connected.',
      schema: z.object({
        domain: z.string().min(3).max(200).describe('The domain, e.g. "example.com"'),
        country: z.string().max(60).optional().describe('Two-letter country code or country name (default "us")'),
        limit: z.number().int().min(1).max(500).optional().describe('How many keywords (default 100)'),
      }),
    },
  );
}

function ahrefsBrandRadarTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const { ahrefsBrandRadar } = await import('@/libs/tools/serp/ahrefs');
        const r = await ahrefsBrandRadar(args.brand, { competitors: args.competitors, source: args.assistant, country: args.country, limit: args.limit, orgId: ctx.orgId });
        return JSON.stringify({ source: 'Ahrefs Brand Radar (the workspace\'s own plan)', ...r });
      } catch (err) {
        return ahrefsFailure(err);
      }
    },
    {
      name: 'ahrefs_brand_radar',
      description: 'The questions people ask AI assistants (Google AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini, Copilot) whose answers mention a brand or its competitors, from the workspace\'s Ahrefs Brand Radar: each question, the start of the answer, the links it cited and its volume. Needs Ahrefs connected with Brand Radar on its plan.',
      schema: z.object({
        brand: z.string().min(1).max(120).describe('The brand, as people name it'),
        competitors: z.array(z.string().min(1).max(120)).max(10).optional(),
        assistant: z.enum(['google_ai_overviews', 'google_ai_mode', 'chatgpt', 'perplexity', 'gemini', 'copilot']).optional().describe('Which assistant (default google_ai_overviews)'),
        country: z.string().max(60).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('How many answers (default 25)'),
      }),
    },
  );
}

/**
 * The SEO data tools this agent was granted: all of them with `serp`, or any one by name.
 * @param ctx - The turn.
 */
export function seoDataTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const build: Record<(typeof SEO_DATA_TOOL_NAMES)[number], (c: RuntimeContext) => StructuredToolInterface> = {
    search_console_queries: searchConsoleQueriesTool,
    search_console_pages: searchConsolePagesTool,
    ahrefs_organic_keywords: ahrefsOrganicKeywordsTool,
    ahrefs_brand_radar: ahrefsBrandRadarTool,
  };
  return SEO_DATA_TOOL_NAMES.filter(name => granted(ctx, name)).map(name => build[name](ctx));
}
