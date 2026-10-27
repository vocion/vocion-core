import type { SerpLocalResult, SerpProvider, SerpQuery, SerpResult } from './types';
import process from 'node:process';
import { resolveToolProviderKey } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';
import { clampNum, domainOf, numberOf } from './types';

/** The part of SerpApi's Google response this reads. */
export type SerpApiResponse = {
  search_metadata?: { status?: string; processed_at?: string };
  search_parameters?: { q?: string; location_used?: string; hl?: string; gl?: string; device?: string };
  error?: string;
  answer_box?: { title?: string; snippet?: string; answer?: string; link?: string };
  organic_results?: Array<{ position?: number; title?: string; link?: string; snippet?: string; date?: string }>;
  related_questions?: Array<{ question?: string; snippet?: string; link?: string }>;
  related_searches?: Array<{ query?: string }>;
  /** The local pack: `{ places: [...] }`, or the list itself on older responses. */
  local_results?: SerpApiPlace[] | { places?: SerpApiPlace[] };
  ads?: unknown[];
};

type SerpApiPlace = {
  position?: number;
  title?: string;
  rating?: number | string;
  reviews?: number | string;
  type?: string;
  address?: string;
  phone?: string;
  website?: string;
  links?: { website?: string; directions?: string };
};

/**
 * SerpApi's `local_results` as the local pack.
 * @param local - SerpApi's field.
 */
export function serpApiLocalPack(local: SerpApiResponse['local_results']): SerpLocalResult[] {
  const places = Array.isArray(local) ? local : (local?.places ?? []);
  return places
    .filter(p => typeof p.title === 'string' && p.title.trim())
    .map((p, i) => {
      const rating = numberOf(p.rating);
      const reviews = numberOf(p.reviews);
      const website = p.links?.website ?? p.website;
      const domain = website ? domainOf(website) : '';
      return {
        position: numberOf(p.position) ?? i + 1,
        name: p.title!.trim(),
        ...(rating !== undefined ? { rating } : {}),
        ...(reviews !== undefined ? { reviews } : {}),
        ...(p.type ? { category: p.type } : {}),
        ...(website ? { website } : {}),
        ...(domain ? { domain } : {}),
        ...(p.address ? { address: p.address } : {}),
      };
    });
}

/**
 * SerpApi (serpapi.com) — Google's results page as JSON. One key, sent as
 * `api_key`; `location`, `hl`, `gl`, `num` and `device` are its parameters.
 * No keyword volume or ideas.
 *
 * Spends the org's own key when it stored one, else `SERPAPI_API_KEY`.
 */
export function serpApiProvider(): SerpProvider {
  const requiredEnv = ['SERPAPI_API_KEY'];
  return {
    name: 'serpapi',
    requiredEnv,
    isReady: () => Boolean(process.env.SERPAPI_API_KEY),
    async search(q, opts) {
      const orgKey = opts?.orgId ? await resolveToolProviderKey('serpapi', opts.orgId) : null;
      const apiKey = orgKey ?? process.env.SERPAPI_API_KEY;
      if (!apiKey) {
        throw new ProviderNotConfiguredError('serp', 'serpapi', requiredEnv);
      }
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', q.query);
      url.searchParams.set('num', String(clampNum(q.num)));
      if (q.location) {
        url.searchParams.set('location', q.location);
      }
      if (q.language) {
        url.searchParams.set('hl', q.language.toLowerCase());
      }
      if (q.country) {
        url.searchParams.set('gl', q.country.toLowerCase());
      }
      if (q.device) {
        url.searchParams.set('device', q.device);
      }
      url.searchParams.set('api_key', apiKey);
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        // The URL carries the key, so the error never repeats it.
        throw new Error(`SerpApi search failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as SerpApiResponse;
      if (data.error) {
        throw new Error(`SerpApi search failed: ${data.error}`);
      }
      return normaliseSerpApi(q, data, new Date());
    },
  };
}

/**
 * SerpApi's response in the one SERP shape. Pure, so the fixtures test it.
 * @param q - What was asked.
 * @param data - SerpApi's JSON.
 * @param at - When it was read.
 */
export function normaliseSerpApi(q: SerpQuery, data: SerpApiResponse, at: Date): SerpResult {
  const box = data.answer_box;
  const boxText = box?.snippet ?? box?.answer;
  return {
    query: q.query,
    provider: 'serpapi',
    isGoogleRanking: true,
    location: data.search_parameters?.location_used ?? q.location,
    language: data.search_parameters?.hl ?? q.language,
    country: data.search_parameters?.gl ?? q.country,
    device: data.search_parameters?.device === 'mobile' ? 'mobile' : (q.device ?? 'desktop'),
    organic: (data.organic_results ?? [])
      .filter(r => r.link)
      .map((r, i) => ({
        position: r.position ?? i + 1,
        url: r.link!,
        domain: domainOf(r.link!),
        title: r.title ?? r.link!,
        snippet: r.snippet ?? '',
        ...(r.date ? { date: r.date } : {}),
      })),
    ...(boxText ? { featuredSnippet: { snippet: boxText, ...(box?.title ? { title: box.title } : {}), ...(box?.link ? { url: box.link } : {}) } } : {}),
    peopleAlsoAsk: (data.related_questions ?? [])
      .filter(p => p.question)
      .map(p => ({ question: p.question!, ...(p.snippet ? { snippet: p.snippet } : {}), ...(p.link ? { url: p.link } : {}) })),
    relatedSearches: (data.related_searches ?? []).map(r => r.query ?? '').filter(Boolean),
    localPack: serpApiLocalPack(data.local_results),
    adsCount: Array.isArray(data.ads) ? data.ads.length : 0,
    retrievedAt: (data.search_metadata?.processed_at ? new Date(data.search_metadata.processed_at.replace(' UTC', 'Z').replace(' ', 'T')) : at).toISOString(),
    billedUnits: 1,
  };
}
