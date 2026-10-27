import type { SerpProvider, SerpQuery, SerpResult } from './types';
import process from 'node:process';
import { resolveToolProviderKey } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';
import { clampNum, domainOf } from './types';

/** The part of Serper's `/search` response this reads. */
export type SerperResponse = {
  searchParameters?: { q?: string; gl?: string; hl?: string; location?: string; num?: number };
  answerBox?: { title?: string; snippet?: string; answer?: string; link?: string };
  organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string; position?: number }>;
  peopleAlsoAsk?: Array<{ question?: string; snippet?: string; title?: string; link?: string }>;
  relatedSearches?: Array<{ query?: string }>;
  ads?: unknown[];
  credits?: number;
};

/**
 * Serper (google.serper.dev) — Google's results page as JSON, the Cloud
 * default. One key, sent as `X-API-KEY`; `gl`, `hl`, `location` and `num`
 * are Google's own parameters and pass straight through.
 *
 * What Serper does not give: search volume (no keyword data at all), ads on
 * the page, and a device switch. Those come back as null or a note rather
 * than a guess.
 *
 * Spends the org's own key when it stored one, else `SERPER_API_KEY`.
 */
export function serperProvider(): SerpProvider {
  const requiredEnv = ['SERPER_API_KEY'];
  return {
    name: 'serper',
    requiredEnv,
    isReady: () => Boolean(process.env.SERPER_API_KEY),
    async search(q, opts) {
      const orgKey = opts?.orgId ? await resolveToolProviderKey('serper', opts.orgId) : null;
      const apiKey = orgKey ?? process.env.SERPER_API_KEY;
      if (!apiKey) {
        throw new ProviderNotConfiguredError('serp', 'serper', requiredEnv);
      }
      const body: Record<string, unknown> = { q: q.query, num: clampNum(q.num) };
      if (q.country) {
        body.gl = q.country.toLowerCase();
      }
      if (q.language) {
        body.hl = q.language.toLowerCase();
      }
      if (q.location) {
        body.location = q.location;
      }
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(`Serper search failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
      }
      return normaliseSerper(q, (await res.json()) as SerperResponse, new Date());
    },
  };
}

/**
 * Serper's response in the one SERP shape. Pure, so the fixtures test it.
 * @param q - What was asked.
 * @param data - Serper's JSON.
 * @param at - When it was read.
 */
export function normaliseSerper(q: SerpQuery, data: SerperResponse, at: Date): SerpResult {
  const organic = (data.organic ?? [])
    .filter(r => typeof r.link === 'string' && r.link)
    .map((r, i) => ({
      position: r.position ?? i + 1,
      url: r.link!,
      domain: domainOf(r.link!),
      title: r.title ?? r.link!,
      snippet: r.snippet ?? '',
      ...(r.date ? { date: r.date } : {}),
    }));
  const box = data.answerBox;
  const boxText = box?.snippet ?? box?.answer;
  return {
    query: q.query,
    provider: 'serper',
    isGoogleRanking: true,
    ...(q.device === 'mobile' ? { note: 'Serper reads the desktop results page; the mobile ranking can differ.' } : {}),
    location: data.searchParameters?.location ?? q.location,
    language: data.searchParameters?.hl ?? q.language,
    country: data.searchParameters?.gl ?? q.country,
    device: 'desktop',
    organic,
    ...(boxText ? { featuredSnippet: { snippet: boxText, ...(box?.title ? { title: box.title } : {}), ...(box?.link ? { url: box.link } : {}) } } : {}),
    peopleAlsoAsk: (data.peopleAlsoAsk ?? [])
      .filter(p => p.question)
      .map(p => ({ question: p.question!, ...(p.snippet ? { snippet: p.snippet } : {}), ...(p.link ? { url: p.link } : {}) })),
    relatedSearches: (data.relatedSearches ?? []).map(r => r.query ?? '').filter(Boolean),
    adsCount: Array.isArray(data.ads) ? data.ads.length : null,
    retrievedAt: at.toISOString(),
    billedUnits: data.credits ?? 1,
  };
}
