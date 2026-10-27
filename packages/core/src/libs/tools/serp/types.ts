/**
 * SERP research — Google's results page for a query, as one shape whatever
 * vendor read it (`./serper.ts`, `./dataforseo.ts`, `./serpapi.ts`), plus
 * keyword volume where a vendor has it.
 *
 * Mirrors `libs/tools/websearch/`: a provider interface, an env-driven
 * registry (`VOCION_SERP_PROVIDER`), and the org's own stored key before the
 * server's (`libs/tools/orgKey.ts`).
 */

export type SerpProviderName = 'serper' | 'dataforseo' | 'serpapi';

export type SerpDevice = 'desktop' | 'mobile';

export type SerpQuery = {
  query: string;
  /** Free-text place, as Google's location names read: "Denver, Colorado, United States". */
  location?: string;
  /** Interface language, ISO 639-1: `en`. Google's `hl`. */
  language?: string;
  /** Country, ISO 3166-1 alpha-2: `us`. Google's `gl`. */
  country?: string;
  device?: SerpDevice;
  /** How many organic results to ask for (1–100; default 10). */
  num?: number;
};

export type SerpOrganicResult = {
  /** 1-based rank among organic results. */
  position: number;
  url: string;
  /** Host without `www.` — the unit SEO compares on. */
  domain: string;
  title: string;
  snippet: string;
  /** The date Google showed beside the result, as shown ("Jul 19, 2026", "3 days ago"). */
  date?: string;
};

export type SerpFeaturedSnippet = {
  title?: string;
  snippet: string;
  url?: string;
};

export type SerpQuestion = {
  question: string;
  snippet?: string;
  url?: string;
};

/** One results page, normalised. */
export type SerpResult = {
  query: string;
  /** Who read it: a SERP vendor, or `web_search:<name>` on the fallback. */
  provider: SerpProviderName | `web_search:${string}`;
  /** False on the fallback, whose order is the search engine's, not Google's. */
  isGoogleRanking: boolean;
  /** Said to the reader whenever the result is not plainly Google's page. */
  note?: string;
  location?: string;
  language?: string;
  country?: string;
  device: SerpDevice;
  organic: SerpOrganicResult[];
  featuredSnippet?: SerpFeaturedSnippet;
  peopleAlsoAsk: SerpQuestion[];
  relatedSearches: string[];
  /** Paid results on the page; null when the provider does not report ads. */
  adsCount: number | null;
  /** ISO time the page was read. */
  retrievedAt: string;
  /** Vendor billing units this read spent (Serper credits, DataForSEO pages, SerpApi searches). */
  billedUnits: number;
};

export type KeywordMetric = {
  keyword: string;
  /** Average monthly searches, or null when the vendor had none for it. */
  searchVolume: number | null;
  /** Average cost per click in USD. */
  cpc: number | null;
  /** Google Ads competition: LOW | MEDIUM | HIGH. */
  competition: string | null;
  /** Google Ads competition index, 0–100. */
  competitionIndex: number | null;
  /** The last months, newest first, when the vendor gives them. */
  monthly?: Array<{ year: number; month: number; searchVolume: number | null }>;
};

export type KeywordMetricsResult = {
  provider: SerpProviderName;
  location: string;
  language: string;
  metrics: KeywordMetric[];
  retrievedAt: string;
  billedUnits: number;
};

export type SerpCallOptions = {
  /** The org the call is for: whose stored key it spends. */
  orgId?: string;
};

export type SerpProvider = {
  readonly name: SerpProviderName;
  /** Env vars the server needs for this provider; an org key can stand in. */
  readonly requiredEnv: string[];
  /** True when the server's own key is set. */
  isReady: () => boolean;
  search: (q: SerpQuery, opts?: SerpCallOptions) => Promise<SerpResult>;
  /** Search volume, CPC and competition. Absent on a vendor that has none. */
  keywordMetrics?: (keywords: string[], where: { location?: string; language?: string }, opts?: SerpCallOptions) => Promise<KeywordMetricsResult>;
};

/**
 * Host without `www.`, lower case; '' for something that is not a URL.
 * @param url - The URL.
 */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The number of results to ask for, clamped.
 * @param num - What was asked for.
 */
export function clampNum(num: number | undefined): number {
  return Math.max(1, Math.min(100, Math.round(num ?? 10)));
}
