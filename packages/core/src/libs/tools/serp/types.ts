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

/**
 * One business in the local pack (the map pack): the three or so listings
 * Google shows under a map for a query with local intent. For a
 * home-services query this is often what a searcher sees first.
 */
export type SerpLocalResult = {
  /** 1-based place in the pack. */
  position: number;
  name: string;
  /** Star rating as shown (out of 5), when shown. */
  rating?: number;
  /** How many reviews the rating rests on, when shown. */
  reviews?: number;
  /** The business category Google shows ("Plumber"), when shown. */
  category?: string;
  /** The business's own website, when the listing links one. */
  website?: string;
  /** That website's host without `www.`. */
  domain?: string;
  address?: string;
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
  /**
   * The local pack, in order; empty when the page showed none. Optional only
   * so results read before it existed still parse.
   */
  localPack?: SerpLocalResult[];
  /** Paid results on the page; null when the provider does not report ads. */
  adsCount: number | null;
  /**
   * Google's AI Overview on this page, with the domains it cites. Absent when
   * the provider cannot see it (Serper, SerpApi): unknown, never "none".
   */
  aiOverview?: AiOverview;
  /** The other SERP features on the page (`featured_snippet`, `local_pack`, `video`…), when the provider lists them. */
  serpFeatures?: string[];
  /** ISO time the page was read. */
  retrievedAt: string;
  /** Vendor billing units this read spent (Serper credits, DataForSEO pages, SerpApi searches). */
  billedUnits: number;
};

/** Who measured a keyword: a keyword data vendor. */
export type KeywordDataSource = 'dataforseo' | 'ahrefs';

/**
 * Whether Google shows an AI Overview for a search, and which domains it
 * cites. `citedDomains` is null when the overview's sources were not read
 * (only the presence came back, from a keyword database's own snapshot of
 * the page); an empty list means it was read and cites none.
 */
export type AiOverview = {
  present: boolean;
  citedDomains: string[] | null;
  /** Who saw it and when: a SERP read can be newer than the keyword's numbers. */
  source: KeywordDataSource;
  checkedAt: string;
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
  /** The last months, newest first, when the vendor gives them (up to 12). */
  monthly?: Array<{ year: number; month: number; searchVolume: number | null }>;
  /** Keyword difficulty, 0–100 (the vendor's own scale), or null when it had none. */
  kd?: number | null;
  /** The main search intent: informational | navigational | commercial | transactional. */
  intent?: string | null;
  /** SERP features Google shows for it (`ai_overview`, `featured_snippet`, `local_pack`…), from the vendor's last look. */
  serpFeatures?: string[] | null;
  /** Whether an AI Overview shows, and what it cites; null when the vendor did not look. */
  aiOverview?: AiOverview | null;
  /** Ahrefs only: the organic traffic the #1 page for it gets. */
  trafficPotential?: number | null;
  /** Who measured it. */
  source?: KeywordDataSource;
  /** When it was measured (ISO). A cached row keeps the date it was first read. */
  checkedAt?: string;
};

export type KeywordMetricsResult = {
  provider: KeywordDataSource;
  location: string;
  language: string;
  metrics: KeywordMetric[];
  retrievedAt: string;
  billedUnits: number;
  /** What the vendor reported this call cost, in USD, when it reports it (DataForSEO does). */
  costUsd?: number;
  /** Keywords answered from the 7-day cache rather than bought again. */
  cachedKeywords?: number;
};

/**
 * A keyword row in the shape the Keywords register's upsert takes
 * (`services/seo/keywords.ts`, `seo_keyword`): every number with its source
 * and the date it was read.
 */
export type KeywordRecordShape = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  intent: string | null;
  cpc: number | null;
  serp_features: string[] | null;
  ai_overview: { present: boolean; cited_domains: string[] | null } | null;
  source: KeywordDataSource;
  checked_at: string;
};

/** Keyword ideas: related searches Google Ads suggests for seed keywords, with their numbers. */
export type KeywordIdeasResult = {
  provider: KeywordDataSource;
  location: string;
  language: string;
  seeds: string[];
  ideas: KeywordMetric[];
  retrievedAt: string;
  billedUnits: number;
  /** What the vendor reported this call cost, in USD. */
  costUsd?: number;
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
  /** Search volume, CPC, competition, difficulty and intent. Absent on a vendor that has none. */
  keywordMetrics?: (keywords: string[], where: { location?: string; language?: string }, opts?: SerpCallOptions) => Promise<KeywordMetricsResult>;
  /** Related keywords with their numbers, from seeds. Absent on a vendor that has none. */
  keywordIdeas?: (seeds: string[], where: { location?: string; language?: string }, opts?: SerpCallOptions) => Promise<KeywordIdeasResult>;
};

/**
 * A measured keyword in the Keywords register's shape. A keyword with no
 * source (an old cached row) reads as DataForSEO's, its date the read's.
 * @param m - The keyword's numbers.
 * @param readAt - When the call that returned it was made.
 */
export function keywordRecordOf(m: KeywordMetric, readAt: string): KeywordRecordShape {
  return {
    keyword: m.keyword,
    volume: m.searchVolume,
    kd: m.kd ?? null,
    intent: m.intent ?? null,
    cpc: m.cpc,
    serp_features: m.serpFeatures ?? null,
    ai_overview: m.aiOverview ? { present: m.aiOverview.present, cited_domains: m.aiOverview.citedDomains } : null,
    source: m.source ?? 'dataforseo',
    checked_at: m.checkedAt ?? readAt,
  };
}

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
 * A number from a vendor field that may be a number, a numeric string or
 * "1,204"; undefined when it is none of those.
 * @param v - The raw value.
 */
export function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '$1'));
    return v.trim() && Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * The number of results to ask for, clamped.
 * @param num - What was asked for.
 */
export function clampNum(num: number | undefined): number {
  return Math.max(1, Math.min(100, Math.round(num ?? 10)));
}
