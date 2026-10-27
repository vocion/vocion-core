import type { CapabilityStatus } from '../types';
import type { KeywordIdeasResult, KeywordMetricsResult, SerpCallOptions, SerpProvider, SerpProviderName, SerpQuery, SerpResult } from './types';
import process from 'node:process';
import { statusForProvider } from '../status';
import { ProviderNotConfiguredError } from '../types';
import { getWebSearchProvider, resolveWebSearchProviderName } from '../websearch/registry';
import { dataForSeoProvider } from './dataforseo';
import { serpApiProvider } from './serpapi';
import { serperProvider } from './serper';
import { clampNum, domainOf } from './types';

const NAMES: readonly SerpProviderName[] = ['serper', 'dataforseo', 'serpapi'];

const LABELS: Record<SerpProviderName, string> = { serper: 'Serper', dataforseo: 'DataForSEO', serpapi: 'SerpApi' };

/**
 * The SERP provider `VOCION_SERP_PROVIDER` names, or null when it names none.
 * Unset is not an error: the providers are then tried in order, Serper first.
 */
export function configuredSerpProviderName(): SerpProviderName | null {
  const raw = (process.env.VOCION_SERP_PROVIDER ?? '').trim().toLowerCase();
  return (NAMES as readonly string[]).includes(raw) ? raw as SerpProviderName : null;
}

export function getSerpProvider(name: SerpProviderName): SerpProvider {
  switch (name) {
    case 'dataforseo':
      return dataForSeoProvider();
    case 'serpapi':
      return serpApiProvider();
    default:
      return serperProvider();
  }
}

/**
 * The providers to try, in order: the one `VOCION_SERP_PROVIDER` names, alone;
 * else the ones the server holds a key for, then the rest (an org may have
 * stored its own key for any of them), Serper first.
 */
function candidates(): SerpProvider[] {
  const named = configuredSerpProviderName();
  if (named) {
    return [getSerpProvider(named)];
  }
  const all = NAMES.map(getSerpProvider);
  return [...all.filter(p => p.isReady()), ...all.filter(p => !p.isReady())];
}

/**
 * A provider's name as a person reads it.
 * @param name - The provider name.
 */
export function serpProviderLabel(name: string): string {
  return LABELS[name as SerpProviderName] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Google's results page for a query, from the first SERP provider that has a
 * key (the org's own first, then the server's).
 *
 * With none, the configured `web_search` provider answers instead, and the
 * result says so plainly (`isGoogleRanking: false`, `note`): its order is that
 * engine's, not Google's, and it has no People Also Ask or related searches.
 * An org key that could not be READ is not "none" — that error is thrown, so
 * nothing quietly spends another account or substitutes another engine.
 *
 * `googleOnly` turns the fallback off: SEO work (a SERP brief, a keyword
 * cluster) built on another engine's order looks authoritative and is not,
 * so those callers get `ProviderNotConfiguredError` instead.
 * @param q - The query and where it is searched from.
 * @param opts - The org the call is for, and whether only Google will do.
 */
export async function searchSerp(q: SerpQuery, opts: SerpCallOptions & { googleOnly?: boolean } = {}): Promise<SerpResult> {
  for (const provider of candidates()) {
    try {
      return await provider.search(q, opts);
    } catch (err) {
      if (!(err instanceof ProviderNotConfiguredError)) {
        throw err;
      }
    }
  }
  if (opts.googleOnly) {
    throw new ProviderNotConfiguredError('serp', 'serper', ['VOCION_SERP_PROVIDER', 'SERPER_API_KEY']);
  }
  return webSearchFallback(q, opts);
}

/**
 * The fallback: the web search provider's results in the SERP shape, labelled.
 * @param q - The query.
 * @param opts - The org the call is for.
 */
async function webSearchFallback(q: SerpQuery, opts: SerpCallOptions): Promise<SerpResult> {
  const name = resolveWebSearchProviderName();
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  let results;
  try {
    results = await getWebSearchProvider(name).search(q.query, { count: Math.min(clampNum(q.num), 10), orgId: opts.orgId });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      throw new ProviderNotConfiguredError('serp', 'serper', ['VOCION_SERP_PROVIDER', 'SERPER_API_KEY']);
    }
    throw err;
  }
  return {
    query: q.query,
    provider: `web_search:${name}`,
    isGoogleRanking: false,
    note: `${label} results, not Google's ranking. No SERP provider is configured, so positions, People Also Ask and related searches are not Google's. A workspace admin can add a Serper key under API credentials.`,
    location: q.location,
    language: q.language,
    country: q.country,
    device: q.device ?? 'desktop',
    organic: results.filter(r => r.url).map((r, i) => ({
      position: i + 1,
      url: r.url,
      domain: domainOf(r.url),
      title: r.title,
      snippet: r.snippet,
      ...(r.publishedAt ? { date: r.publishedAt } : {}),
    })),
    peopleAlsoAsk: [],
    relatedSearches: [],
    adsCount: null,
    retrievedAt: new Date().toISOString(),
    billedUnits: 0,
  };
}

/** What `keyword_metrics` gets: the numbers, or the plain reason there are none. */
export type KeywordMetricsOutcome
  = | { ok: true; result: KeywordMetricsResult }
    | { ok: false; reason: string };

/**
 * Search volume, CPC and competition for keywords. Only DataForSEO has them
 * (Google Ads data), so it is asked whenever a DataForSEO login is held —
 * the org's or the server's — whatever provider reads the results page.
 * Without one the answer is the reason, never an estimate.
 * @param keywords - The keywords.
 * @param where - Location and language.
 * @param where.location - A free-text place.
 * @param where.language - ISO 639-1.
 * @param opts - The org the call is for.
 */
export async function keywordMetrics(keywords: string[], where: { location?: string; language?: string }, opts: SerpCallOptions = {}): Promise<KeywordMetricsOutcome> {
  const dfs = dataForSeoProvider();
  try {
    return { ok: true, result: await dfs.keywordMetrics!(keywords, where, opts) };
  } catch (err) {
    if (!(err instanceof ProviderNotConfiguredError)) {
      throw err;
    }
  }
  const active = configuredSerpProviderName() ?? candidates()[0]?.name ?? 'serper';
  const why = active === 'dataforseo'
    ? 'DataForSEO is the SERP provider but no DataForSEO API login is configured'
    : `${serpProviderLabel(active)} gives no search volume`;
  return {
    ok: false,
    reason: `Could not establish volume: ${why}. DataForSEO has it (Google Ads data); a workspace admin can add a DataForSEO API login under API credentials. Do not estimate volumes.`,
  };
}

/** What keyword ideas came back as: the ideas, or the plain reason there are none. */
export type KeywordIdeasOutcome
  = | { ok: true; result: KeywordIdeasResult }
    | { ok: false; reason: string };

/**
 * Keyword ideas (related searches Google Ads suggests, with their numbers)
 * for seed keywords. Only DataForSEO has them; Serper and SerpApi have no
 * keyword data at all, and the answer then says so.
 * @param seeds - Seed keywords (the first 20 are used).
 * @param where - Location and language.
 * @param where.location - A free-text place.
 * @param where.language - ISO 639-1.
 * @param opts - The org the call is for.
 */
export async function keywordIdeas(seeds: string[], where: { location?: string; language?: string }, opts: SerpCallOptions = {}): Promise<KeywordIdeasOutcome> {
  const dfs = dataForSeoProvider();
  try {
    return { ok: true, result: await dfs.keywordIdeas!(seeds, where, opts) };
  } catch (err) {
    if (!(err instanceof ProviderNotConfiguredError)) {
      throw err;
    }
  }
  const active = configuredSerpProviderName() ?? candidates()[0]?.name ?? 'serper';
  const why = active === 'dataforseo'
    ? 'DataForSEO is the SERP provider but no DataForSEO API login is configured'
    : `keyword ideas are not available on ${serpProviderLabel(active)}, which has no keyword data`;
  return {
    ok: false,
    reason: `No keyword ideas: ${why}. DataForSEO has them (Google Ads data); a workspace admin can add a DataForSEO API login under API credentials. Use People Also Ask and related searches from serp_search instead, and do not invent keywords with numbers.`,
  };
}

/**
 * For the Tools catalog: the provider a search would use first. Never throws.
 * @param orgId - The org to report for.
 */
export async function serpStatus(orgId?: string): Promise<CapabilityStatus> {
  const first = candidates()[0] ?? serperProvider();
  return statusForProvider('serp', first, orgId);
}
