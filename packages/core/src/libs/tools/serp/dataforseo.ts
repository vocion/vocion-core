import type { AiOverview, KeywordIdeasResult, KeywordMetric, KeywordMetricsResult, SerpCallOptions, SerpLocalResult, SerpProvider, SerpQuery, SerpResult } from './types';
import type { CredentialValues } from '@/libs/platforms/registry';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { resolveToolProviderCredential } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';
import { clampNum, domainOf, numberOf } from './types';

const API = 'https://api.dataforseo.com/v3';

/** Seeds one keyword-ideas task takes (Google Ads keywords_for_keywords). */
export const KEYWORD_IDEA_SEEDS = 20;

/** Ideas kept from one call, highest volume first: evidence, not the whole long tail. */
const KEYWORD_IDEAS_CAP = 200;

/** Keywords one DataForSEO Labs keyword overview task takes. */
export const LABS_OVERVIEW_MAX = 700;

/** Keywords one Google Ads search volume task takes. */
export const ADS_VOLUME_MAX = 1000;

/** One item on DataForSEO's advanced SERP; only the fields read here. */
type DfsItem = {
  type?: string;
  rank_group?: number;
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  timestamp?: string | null;
  /** On a `local_pack` item: the stars and how many reviews. */
  rating?: { value?: number | string | null; votes_count?: number | string | null } | null;
  items?: Array<string | { type?: string; title?: string; expanded_element?: Array<{ url?: string; description?: string }>; references?: DfsReference[] | null }>;
  /** On an `ai_overview` item: the pages it cites. */
  references?: DfsReference[] | null;
  /** On an `ai_overview` item: it loaded after the page, which bills the extra async read. */
  asynchronous_ai_overview?: boolean;
};

/** A page an AI Overview cites. */
type DfsReference = { domain?: string | null; url?: string | null; source?: string | null; title?: string | null };

/** The envelope every DataForSEO endpoint answers in. */
export type DataForSeoResponse<R> = {
  status_code?: number;
  status_message?: string;
  /** What the call cost, USD. */
  cost?: number;
  tasks?: Array<{ status_code?: number; status_message?: string; cost?: number; result?: R[] | null }>;
};

export type DataForSeoSerpResult = {
  keyword?: string;
  location_code?: number;
  language_code?: string;
  datetime?: string;
  /** Every kind of element on the page, `ai_overview` included. */
  item_types?: string[] | null;
  items?: DfsItem[];
};

export type DataForSeoVolumeResult = {
  keyword?: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition?: string | null;
  competition_index?: number | null;
  monthly_searches?: Array<{ year?: number; month?: number; search_volume?: number | null }> | null;
};

/** One keyword in DataForSEO Labs' keyword overview; only the fields read here. */
export type DataForSeoOverviewItem = {
  keyword?: string;
  keyword_info?: {
    last_updated_time?: string | null;
    /** 0–1 on Labs (Google Ads' index divided by 100). */
    competition?: number | null;
    competition_level?: string | null;
    cpc?: number | null;
    search_volume?: number | null;
    monthly_searches?: Array<{ year?: number; month?: number; search_volume?: number | null }> | null;
  } | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
  serp_info?: { serp_item_types?: string[] | null; last_updated_time?: string | null } | null;
};

export type DataForSeoOverviewResult = { items?: DataForSeoOverviewItem[] | null };

/**
 * DataForSEO — Google Organic "Live Advanced" for the results page (with
 * the AI Overview and what it cites), DataForSEO Labs' keyword overview for
 * keyword metrics (volume and its last twelve months, difficulty, CPC,
 * intent, the SERP features Google shows), Google Ads search volume for
 * what Labs has not seen and for a city, and Google Ads keyword ideas: the
 * one provider here that can say how many people search a term, how hard
 * it is to rank for, or what else they search.
 *
 * Its credential is a pair (API login + API password, Basic auth). The org's
 * stored pair wins; else `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`.
 */
export function dataForSeoProvider(): SerpProvider {
  const requiredEnv = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'];

  async function auth(opts?: SerpCallOptions): Promise<string> {
    const org: CredentialValues | null = opts?.orgId ? await resolveToolProviderCredential('dataforseo', opts.orgId) : null;
    const login = org?.login ?? process.env.DATAFORSEO_LOGIN;
    const password = org?.password ?? process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) {
      throw new ProviderNotConfiguredError('serp', 'dataforseo', requiredEnv);
    }
    return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  }

  async function post<R>(path: string, task: Record<string, unknown>, opts?: SerpCallOptions): Promise<R> {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': await auth(opts) },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`DataForSEO ${path} failed: HTTP ${res.status}`);
    }
    return firstResult<R>((await res.json()) as DataForSeoResponse<R>, path);
  }

  /**
   * One task, the whole envelope back (its cost included), refused in DataForSEO's own words.
   * @param path - The endpoint.
   * @param task - The one task.
   * @param authorization - The Basic header.
   */
  async function postAll<R>(path: string, task: Record<string, unknown>, authorization: string): Promise<DataForSeoResponse<R>> {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authorization },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`DataForSEO ${path} failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as DataForSeoResponse<R>;
    const t = data.tasks?.[0];
    if (data.status_code !== 20000 || !t || t.status_code !== 20000) {
      throw new Error(`DataForSEO ${path}: ${t?.status_message ?? data.status_message ?? 'no task came back'}`);
    }
    return data;
  }

  return {
    name: 'dataforseo',
    requiredEnv,
    isReady: () => Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
    async search(q, opts) {
      const depth = clampNum(q.num);
      const result = await post<DataForSeoSerpResult>('/serp/google/organic/live/advanced', {
        keyword: q.query,
        location_name: dfsLocation(q.location, q.country),
        language_code: (q.language ?? 'en').toLowerCase(),
        device: q.device ?? 'desktop',
        depth,
        // The AI Overview often loads after the page; this waits for it. The
        // extra read is refunded when the page has none.
        load_async_ai_overview: true,
      }, opts);
      return normaliseDataForSeo(q, result, new Date(), Math.ceil(depth / 10));
    },
    async keywordMetrics(keywords, where, opts) {
      const location = dfsLocation(where.location);
      const language = (where.language ?? 'en').toLowerCase();
      const authorization = await auth(opts);
      const at = new Date();
      // Labs reads countries only; a city's volume comes from Google Ads.
      const country = location.split(',').at(-1) ?? location;
      const local = country !== location;
      let cost = 0;
      let calls = 0;
      const labs = new Map<string, KeywordMetric>();
      for (const part of chunks(keywords, LABS_OVERVIEW_MAX)) {
        const data = await postAll<DataForSeoOverviewResult>('/dataforseo_labs/google/keyword_overview/live', { keywords: part, location_name: country, language_code: language, include_serp_info: true }, authorization);
        cost += data.cost ?? 0;
        calls += 1;
        for (const m of normaliseDataForSeoOverview(data, at)) {
          labs.set(m.keyword.toLowerCase(), m);
        }
      }
      const adsFor = local ? keywords : keywords.filter(k => !labs.has(k.toLowerCase()));
      const ads = new Map<string, KeywordMetric>();
      for (const part of chunks(adsFor, ADS_VOLUME_MAX)) {
        const data = await postAll<DataForSeoVolumeResult>('/keywords_data/google_ads/search_volume/live', { keywords: part, location_name: location, language_code: language }, authorization);
        cost += data.cost ?? 0;
        calls += 1;
        for (const m of normaliseDataForSeoVolume(data, { location, language }, at).metrics) {
          ads.set(m.keyword.toLowerCase(), m);
        }
      }
      const metrics = keywords.flatMap((k): KeywordMetric[] => {
        const fromLabs = labs.get(k.toLowerCase());
        const fromAds = ads.get(k.toLowerCase());
        if (fromLabs && fromAds) {
          // A city: its own volume and CPC, the country's difficulty and intent.
          return [{ ...fromLabs, keyword: k, searchVolume: fromAds.searchVolume, cpc: fromAds.cpc, competition: fromAds.competition, competitionIndex: fromAds.competitionIndex, ...(fromAds.monthly ? { monthly: fromAds.monthly } : {}), checkedAt: fromAds.checkedAt }];
        }
        const one = fromLabs ?? fromAds;
        return one ? [{ ...one, keyword: k }] : [];
      });
      return { provider: 'dataforseo', location, language, metrics, retrievedAt: at.toISOString(), billedUnits: calls, costUsd: Math.round(cost * 1e6) / 1e6 };
    },
    async keywordIdeas(seeds, where, opts) {
      const location = dfsLocation(where.location);
      const language = (where.language ?? 'en').toLowerCase();
      // Google Ads "keywords for keywords" (Keyword Planner's ideas) takes up
      // to 20 seeds per task.
      const keywords = seeds.slice(0, KEYWORD_IDEA_SEEDS);
      const res = await fetch(`${API}/keywords_data/google_ads/keywords_for_keywords/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': await auth(opts) },
        body: JSON.stringify([{ keywords, location_name: location, language_code: language, sort_by: 'search_volume' }]),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`DataForSEO keyword ideas failed: HTTP ${res.status}`);
      }
      return normaliseDataForSeoIdeas((await res.json()) as DataForSeoResponse<DataForSeoVolumeResult>, { location, language, seeds: keywords }, new Date());
    },
  };
}

/**
 * The single result of a one-task call, or an error carrying DataForSEO's own
 * words (its HTTP status is 200 even when the task failed).
 * @param data - The envelope.
 * @param path - For the error.
 */
function firstResult<R>(data: DataForSeoResponse<R>, path: string): R {
  const task = data.tasks?.[0];
  if (data.status_code !== 20000 || !task || task.status_code !== 20000) {
    const why = task?.status_message ?? data.status_message ?? 'no task came back';
    throw new Error(`DataForSEO ${path}: ${why}`);
  }
  const result = task.result?.[0];
  if (!result) {
    throw new Error(`DataForSEO ${path}: the task returned no result`);
  }
  return result;
}

/**
 * DataForSEO's `location_name`: Google's location name with no space after
 * the commas ("Denver,Colorado,United States"); a country code alone becomes
 * its English name; nothing at all is the United States.
 * @param location - A free-text place.
 * @param country - An ISO country code.
 */
export function dfsLocation(location?: string, country?: string): string {
  if (location?.trim()) {
    return location.split(',').map(s => s.trim()).filter(Boolean).join(',');
  }
  if (country?.trim()) {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(country.trim().toUpperCase()) ?? 'United States';
    } catch {
      return 'United States';
    }
  }
  return 'United States';
}

/**
 * DataForSEO's advanced SERP in the one shape. Pure, so the fixtures test it.
 * @param q - What was asked.
 * @param result - The task's first result.
 * @param at - When it was read.
 * @param pages - Pages billed (depth in tens).
 */
export function normaliseDataForSeo(q: SerpQuery, result: DataForSeoSerpResult, at: Date, pages: number): SerpResult {
  const items = result.items ?? [];
  const organic = items
    .filter(i => i.type === 'organic' && i.url)
    .map((i, n) => ({
      position: i.rank_group ?? n + 1,
      url: i.url!,
      domain: (i.domain ?? domainOf(i.url!)).replace(/^www\./, ''),
      title: i.title ?? i.url!,
      snippet: i.description ?? '',
      ...(i.timestamp ? { date: i.timestamp.slice(0, 10) } : {}),
    }));
  const featured = items.find(i => i.type === 'featured_snippet');
  const localPack: SerpLocalResult[] = items
    .filter(i => i.type === 'local_pack' && i.title)
    .map((i, n) => {
      const rating = numberOf(i.rating?.value);
      const reviews = numberOf(i.rating?.votes_count);
      const domain = (i.domain ?? (i.url ? domainOf(i.url) : '')).replace(/^www\./, '');
      return {
        position: n + 1,
        name: i.title!.trim(),
        ...(rating !== undefined ? { rating } : {}),
        ...(reviews !== undefined ? { reviews } : {}),
        ...(i.url ? { website: i.url } : {}),
        ...(domain ? { domain } : {}),
      };
    });
  const overview = items.find(i => i.type === 'ai_overview');
  const checkedAt = dfsTime(result.datetime) ?? at.toISOString();
  const aiOverview: AiOverview = { present: Boolean(overview), citedDomains: overview ? citedDomainsOf(overview) : [], source: 'dataforseo', checkedAt };
  const features = [...new Set((result.item_types ?? items.map(i => i.type ?? '')).filter(t => t && t !== 'organic'))];
  const paa = items.filter(i => i.type === 'people_also_ask').flatMap(i => i.items ?? []);
  const related = items.filter(i => i.type === 'related_searches').flatMap(i => i.items ?? []);
  return {
    query: q.query,
    provider: 'dataforseo',
    isGoogleRanking: true,
    location: dfsLocation(q.location, q.country),
    language: result.language_code ?? q.language ?? 'en',
    country: q.country,
    device: q.device ?? 'desktop',
    organic,
    ...(featured?.description ? { featuredSnippet: { snippet: featured.description, ...(featured.title ? { title: featured.title } : {}), ...(featured.url ? { url: featured.url } : {}) } } : {}),
    peopleAlsoAsk: paa
      .filter((e): e is Exclude<typeof e, string> => typeof e === 'object' && Boolean(e.title))
      .map((e) => {
        const answer = e.expanded_element?.[0];
        return { question: e.title!, ...(answer?.description ? { snippet: answer.description } : {}), ...(answer?.url ? { url: answer.url } : {}) };
      }),
    relatedSearches: related.filter((r): r is string => typeof r === 'string'),
    localPack,
    adsCount: items.filter(i => i.type === 'paid').length,
    aiOverview,
    serpFeatures: features,
    retrievedAt: checkedAt,
    // The AI Overview that loaded late bills one more read.
    billedUnits: pages + (overview?.asynchronous_ai_overview ? 1 : 0),
  };
}

/**
 * The domains an AI Overview cites, in the order it cites them, each once:
 * its own references and its elements'.
 * @param overview - The `ai_overview` item.
 */
export function citedDomainsOf(overview: DfsItem): string[] {
  const refs = [
    ...(overview.references ?? []),
    ...(overview.items ?? []).flatMap(e => (typeof e === 'object' ? e.references ?? [] : [])),
  ];
  const domains = refs.map(r => (r.domain || (r.url ? domainOf(r.url) : '')).toLowerCase().replace(/^www\./, '')).filter(Boolean);
  return [...new Set(domains)];
}

/**
 * DataForSEO's time ("2026-10-27 14:05:12 +00:00") as ISO, or undefined.
 * @param t - The vendor's time.
 */
export function dfsTime(t: string | null | undefined): string | undefined {
  if (!t) {
    return undefined;
  }
  const d = new Date(t.replace(/ ([+-]\d\d:\d\d)$/, '$1').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * A list in pieces of at most `size`.
 * @param list - The list.
 * @param size - The most one piece holds.
 */
export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

/**
 * DataForSEO Labs' keyword overview in the one shape: volume and its last
 * twelve months, difficulty, CPC, competition, the main intent, the SERP
 * features Labs last saw and whether an AI Overview was among them. Each
 * keyword carries the date DataForSEO last measured it, not the date it was
 * asked. Pure, so the fixtures test it.
 * @param data - The envelope.
 * @param at - When it was read (for a keyword with no date of its own).
 */
export function normaliseDataForSeoOverview(data: DataForSeoResponse<DataForSeoOverviewResult>, at: Date): KeywordMetric[] {
  const items = (data.tasks?.[0]?.result ?? []).flatMap(r => r.items ?? []);
  return items.filter(i => i.keyword).map((i): KeywordMetric => {
    const info = i.keyword_info ?? {};
    const serp = i.serp_info;
    const checkedAt = dfsTime(info.last_updated_time) ?? at.toISOString();
    const types = serp?.serp_item_types ?? null;
    const level = info.competition_level?.toUpperCase();
    return {
      keyword: i.keyword!,
      searchVolume: info.search_volume ?? null,
      cpc: info.cpc ?? null,
      competition: level === 'LOW' || level === 'MEDIUM' || level === 'HIGH' ? level : null,
      competitionIndex: typeof info.competition === 'number' ? Math.round(info.competition * 100) : null,
      ...(info.monthly_searches?.length
        ? { monthly: info.monthly_searches.slice(0, 12).map(m => ({ year: m.year ?? 0, month: m.month ?? 0, searchVolume: m.search_volume ?? null })) }
        : {}),
      kd: i.keyword_properties?.keyword_difficulty ?? null,
      intent: i.search_intent_info?.main_intent ?? null,
      serpFeatures: types ? types.filter(t => t !== 'organic') : null,
      aiOverview: types ? { present: types.includes('ai_overview'), citedDomains: null, source: 'dataforseo', checkedAt: dfsTime(serp?.last_updated_time) ?? checkedAt } : null,
      source: 'dataforseo',
      checkedAt,
    };
  });
}

/**
 * DataForSEO's Google Ads search volume in the one shape.
 * @param data - The envelope.
 * @param where - The location and language asked for.
 * @param where.location - DataForSEO location name.
 * @param where.language - Language code.
 * @param at - When it was read.
 */
export function normaliseDataForSeoVolume(data: DataForSeoResponse<DataForSeoVolumeResult>, where: { location: string; language: string }, at: Date): KeywordMetricsResult {
  const task = data.tasks?.[0];
  if (data.status_code !== 20000 || !task || task.status_code !== 20000) {
    throw new Error(`DataForSEO search volume: ${task?.status_message ?? data.status_message ?? 'no task came back'}`);
  }
  return {
    provider: 'dataforseo',
    location: where.location,
    language: where.language,
    metrics: (task.result ?? []).filter(r => r.keyword).map(r => ({ ...metricOf(r), kd: null, intent: null, serpFeatures: null, aiOverview: null, source: 'dataforseo' as const, checkedAt: at.toISOString() })),
    retrievedAt: at.toISOString(),
    billedUnits: 1,
    ...(typeof data.cost === 'number' ? { costUsd: data.cost } : {}),
  };
}

/**
 * One Google Ads keyword row in the one shape.
 * @param r - DataForSEO's row.
 */
function metricOf(r: DataForSeoVolumeResult): KeywordMetric {
  return {
    keyword: r.keyword!,
    searchVolume: r.search_volume ?? null,
    cpc: r.cpc ?? null,
    competition: r.competition ?? null,
    competitionIndex: r.competition_index ?? null,
    ...(r.monthly_searches?.length
      ? { monthly: r.monthly_searches.slice(0, 12).map(m => ({ year: m.year ?? 0, month: m.month ?? 0, searchVolume: m.search_volume ?? null })) }
      : {}),
  };
}

/**
 * DataForSEO's Google Ads keyword ideas in the one shape: highest volume
 * first, the seeds themselves left out, capped.
 * @param data - The envelope.
 * @param where - What was asked.
 * @param where.location - DataForSEO location name.
 * @param where.language - Language code.
 * @param where.seeds - The seed keywords.
 * @param at - When it was read.
 */
export function normaliseDataForSeoIdeas(data: DataForSeoResponse<DataForSeoVolumeResult>, where: { location: string; language: string; seeds: string[] }, at: Date): KeywordIdeasResult {
  const task = data.tasks?.[0];
  if (data.status_code !== 20000 || !task || task.status_code !== 20000) {
    throw new Error(`DataForSEO keyword ideas: ${task?.status_message ?? data.status_message ?? 'no task came back'}`);
  }
  const seeds = new Set(where.seeds.map(s => s.trim().toLowerCase()));
  const seen = new Set<string>();
  const ideas = (task.result ?? [])
    .filter((r) => {
      const k = r.keyword?.trim().toLowerCase();
      if (!k || seeds.has(k) || seen.has(k)) {
        return false;
      }
      seen.add(k);
      return true;
    })
    .map(metricOf)
    .sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1))
    .slice(0, KEYWORD_IDEAS_CAP);
  return { provider: 'dataforseo', location: where.location, language: where.language, seeds: where.seeds, ideas, retrievedAt: at.toISOString(), billedUnits: 1, ...(typeof data.cost === 'number' ? { costUsd: data.cost } : {}) };
}
