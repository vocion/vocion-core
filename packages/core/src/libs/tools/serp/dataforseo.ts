import type { KeywordMetricsResult, SerpCallOptions, SerpProvider, SerpQuery, SerpResult } from './types';
import type { CredentialValues } from '@/libs/platforms/registry';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { resolveToolProviderCredential } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';
import { clampNum, domainOf } from './types';

const API = 'https://api.dataforseo.com/v3';

/** One item on DataForSEO's advanced SERP; only the fields read here. */
type DfsItem = {
  type?: string;
  rank_group?: number;
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  timestamp?: string | null;
  items?: Array<string | { type?: string; title?: string; expanded_element?: Array<{ url?: string; description?: string }> }>;
};

/** The envelope every DataForSEO endpoint answers in. */
export type DataForSeoResponse<R> = {
  status_code?: number;
  status_message?: string;
  tasks?: Array<{ status_code?: number; status_message?: string; result?: R[] | null }>;
};

export type DataForSeoSerpResult = {
  keyword?: string;
  location_code?: number;
  language_code?: string;
  datetime?: string;
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

/**
 * DataForSEO — Google Organic "Live Advanced" for the results page, and
 * Google Ads search volume for keyword metrics: the one provider here that
 * can say how many people search a term.
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
      }, opts);
      return normaliseDataForSeo(q, result, new Date(), Math.ceil(depth / 10));
    },
    async keywordMetrics(keywords, where, opts) {
      const location = dfsLocation(where.location);
      const language = (where.language ?? 'en').toLowerCase();
      const res = await fetch(`${API}/keywords_data/google_ads/search_volume/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': await auth(opts) },
        body: JSON.stringify([{ keywords, location_name: location, language_code: language }]),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`DataForSEO search volume failed: HTTP ${res.status}`);
      }
      return normaliseDataForSeoVolume((await res.json()) as DataForSeoResponse<DataForSeoVolumeResult>, { location, language }, new Date());
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
    adsCount: items.filter(i => i.type === 'paid').length,
    retrievedAt: (result.datetime ? new Date(result.datetime.replace(' +00:00', 'Z').replace(' ', 'T')) : at).toISOString(),
    billedUnits: pages,
  };
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
    metrics: (task.result ?? []).filter(r => r.keyword).map(r => ({
      keyword: r.keyword!,
      searchVolume: r.search_volume ?? null,
      cpc: r.cpc ?? null,
      competition: r.competition ?? null,
      competitionIndex: r.competition_index ?? null,
      ...(r.monthly_searches?.length
        ? { monthly: r.monthly_searches.slice(0, 12).map(m => ({ year: m.year ?? 0, month: m.month ?? 0, searchVolume: m.search_volume ?? null })) }
        : {}),
    })),
    retrievedAt: at.toISOString(),
    billedUnits: 1,
  };
}
