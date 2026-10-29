/**
 * Ahrefs API v3 — a workspace's own Ahrefs, for the numbers an agency
 * already trusts: keyword volume, difficulty (KD) and traffic potential from
 * Keywords Explorer, the keywords a domain ranks for from Site Explorer, and
 * the AI answers that mention a brand from Brand Radar.
 *
 * Ahrefs has no sign-in for API access, so a workspace connects it with an
 * API key (Account settings → API keys), kept under API credentials. There
 * is no server-wide key: the numbers are bought on the workspace's own
 * licence and serve only it. Ahrefs sells API access on its higher plans;
 * a call the plan does not cover is refused with Ahrefs' own words
 * ({@link AhrefsRefusedError}), never turned into an empty answer.
 */

import type { KeywordMetric, KeywordMetricsResult } from './types';
import { resolveToolProviderKey } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';
import { chunks } from './dataforseo';
import { domainOf } from './types';

const API = 'https://api.ahrefs.com/v3';

/** Keywords one overview call carries (they travel in the query string). */
export const AHREFS_OVERVIEW_MAX = 100;

/** A call Ahrefs refused: a bad key, a plan without API access, units spent. */
export class AhrefsRefusedError extends Error {
  readonly status: number;
  constructor(status: number, words: string) {
    super(ahrefsRefusal(status, words));
    this.name = 'AhrefsRefusedError';
    this.status = status;
  }
}

/**
 * What a refusal means, in words a person can act on.
 * @param status - Ahrefs' HTTP status.
 * @param words - Ahrefs' own error text.
 */
export function ahrefsRefusal(status: number, words: string): string {
  const said = words ? ` Ahrefs said: "${words.slice(0, 200)}".` : '';
  if (status === 401) {
    return `Ahrefs did not accept the workspace's API key.${said} A workspace admin can replace it under API credentials.`;
  }
  if (status === 403) {
    return `Ahrefs refused this call: the workspace's Ahrefs plan does not include it.${said} Ahrefs sells API access on its Enterprise plan (and as API units on some others); the same report is in the Ahrefs app.`;
  }
  if (status === 429) {
    return `Ahrefs refused this call: the workspace has used its API units or is calling too fast.${said}`;
  }
  return `Ahrefs failed (HTTP ${status}).${said}`;
}

/** The part of a Keywords Explorer overview row read here. */
export type AhrefsOverviewRow = {
  keyword?: string;
  volume?: number | null;
  difficulty?: number | null;
  traffic_potential?: number | null;
  /** USD cents. */
  cpc?: number | null;
  intents?: Partial<Record<'informational' | 'navigational' | 'commercial' | 'transactional' | 'branded' | 'local', boolean>> | null;
  serp_features?: string[] | null;
};

/** The part of a Site Explorer organic keywords row read here. */
export type AhrefsOrganicRow = {
  keyword?: string;
  volume?: number | null;
  keyword_difficulty?: number | null;
  best_position?: number | null;
  best_position_url?: string | null;
  sum_traffic?: number | null;
  cpc?: number | null;
  serp_features?: string[] | null;
};

/** The part of a Brand Radar AI response row read here. */
export type AhrefsAiResponseRow = {
  question?: string;
  response?: string;
  data_source?: string;
  volume?: number | null;
  links?: Array<string | { url?: string }> | null;
  last_updated?: string | null;
};

const INTENTS = ['transactional', 'commercial', 'navigational', 'informational'] as const;

let regions: Map<string, string> | null = null;

/**
 * A two-letter country code for a place: "us" for "us", "United States" or
 * "Denver, Colorado, United States"; "us" when nothing says. Ahrefs reads
 * countries only.
 * @param location - A free-text place or a country code.
 */
export function ahrefsCountry(location?: string): string {
  const last = (location ?? '').split(',').at(-1)?.trim() ?? '';
  if (/^[a-z]{2}$/i.test(last)) {
    return last.toLowerCase();
  }
  if (!last) {
    return 'us';
  }
  if (!regions) {
    regions = new Map();
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = names.of(code);
        // The first code for a name wins: GB before UK.
        if (name && name !== code && !regions.has(name.toLowerCase())) {
          regions.set(name.toLowerCase(), code.toLowerCase());
        }
      }
    }
  }
  return regions.get(last.toLowerCase()) ?? 'us';
}

/**
 * One Keywords Explorer row in the one keyword shape. Pure.
 * @param r - Ahrefs' row.
 * @param checkedAt - When it was read.
 */
export function ahrefsMetricOf(r: AhrefsOverviewRow, checkedAt: string): KeywordMetric {
  const features = r.serp_features ?? null;
  const intents = INTENTS.filter(i => r.intents?.[i]);
  return {
    keyword: r.keyword!,
    searchVolume: r.volume ?? null,
    cpc: typeof r.cpc === 'number' ? r.cpc / 100 : null,
    competition: null,
    competitionIndex: null,
    kd: r.difficulty ?? null,
    intent: intents.length ? intents.join(', ') : null,
    serpFeatures: features,
    aiOverview: features ? { present: features.includes('ai_overview'), citedDomains: null, source: 'ahrefs', checkedAt } : null,
    trafficPotential: r.traffic_potential ?? null,
    source: 'ahrefs',
    checkedAt,
  };
}

/**
 * The workspace's Ahrefs key, or a not-configured error: there is no
 * server-wide Ahrefs.
 * @param orgId - The workspace.
 */
async function keyFor(orgId: string | undefined): Promise<string> {
  const key = orgId ? await resolveToolProviderKey('ahrefs', orgId) : null;
  if (!key) {
    throw new ProviderNotConfiguredError('keyword data', 'ahrefs', ['an Ahrefs API key under API credentials']);
  }
  return key;
}

/**
 * Whether the workspace has connected Ahrefs. A store that cannot be read
 * answers false here: the keyword numbers then come from DataForSEO and say so.
 * @param orgId - The workspace.
 */
export async function ahrefsConnected(orgId: string | undefined): Promise<boolean> {
  if (!orgId) {
    return false;
  }
  try {
    return Boolean(await resolveToolProviderKey('ahrefs', orgId));
  } catch {
    return false;
  }
}

/**
 * GET an Ahrefs v3 endpoint; the rows under `root`, or the refusal.
 * @param path - The endpoint, e.g. `/keywords-explorer/overview`.
 * @param params - The query.
 * @param key - The API key.
 * @param root - The response key holding the rows.
 */
async function get<R>(path: string, params: Record<string, string>, key: string, root: string): Promise<R[]> {
  const url = `${API}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let words = body;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      words = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error ?? parsed);
    } catch {
      // Not JSON: Ahrefs' words as they came.
    }
    throw new AhrefsRefusedError(res.status, words.trim());
  }
  const data = (await res.json()) as Record<string, unknown>;
  return Array.isArray(data[root]) ? data[root] as R[] : [];
}

/**
 * Volume, KD, traffic potential, CPC, intent and SERP features for keywords,
 * from Keywords Explorer, a hundred per call.
 * @param keywords - The keywords.
 * @param where - Where: Ahrefs reads the country only.
 * @param where.location - A free-text place or a country code.
 * @param where.language - Kept on the result; Ahrefs has no language switch.
 * @param opts - The workspace.
 * @param opts.orgId - Whose Ahrefs.
 */
export async function ahrefsKeywordMetrics(keywords: string[], where: { location?: string; language?: string }, opts: { orgId?: string }): Promise<KeywordMetricsResult> {
  const key = await keyFor(opts.orgId);
  const country = ahrefsCountry(where.location);
  const at = new Date().toISOString();
  const metrics: KeywordMetric[] = [];
  let calls = 0;
  for (const part of chunks(keywords, AHREFS_OVERVIEW_MAX)) {
    const rows = await get<AhrefsOverviewRow>('/keywords-explorer/overview', {
      select: 'keyword,volume,difficulty,traffic_potential,cpc,intents,serp_features',
      country,
      keywords: part.join(','),
      limit: String(part.length),
    }, key, 'keywords');
    calls += 1;
    metrics.push(...rows.filter(r => r.keyword).map(r => ahrefsMetricOf(r, at)));
  }
  return { provider: 'ahrefs', location: country.toUpperCase(), language: (where.language ?? 'en').toLowerCase(), metrics, retrievedAt: at, billedUnits: calls };
}

export type AhrefsOrganicKeyword = {
  keyword: string;
  position: number | null;
  url: string | null;
  volume: number | null;
  kd: number | null;
  traffic: number | null;
  cpc: number | null;
  serpFeatures: string[] | null;
};

/**
 * The keywords a domain ranks for in Google, by the traffic they bring, as
 * of today. Pure over the rows.
 * @param rows - Ahrefs' rows.
 */
export function ahrefsOrganicOf(rows: AhrefsOrganicRow[]): AhrefsOrganicKeyword[] {
  return rows.filter(r => r.keyword).map(r => ({
    keyword: r.keyword!,
    position: r.best_position ?? null,
    url: r.best_position_url ?? null,
    volume: r.volume ?? null,
    kd: r.keyword_difficulty ?? null,
    traffic: r.sum_traffic ?? null,
    cpc: typeof r.cpc === 'number' ? r.cpc / 100 : null,
    serpFeatures: r.serp_features ?? null,
  }));
}

/**
 * The keywords a domain ranks for (Site Explorer → Organic keywords).
 * @param target - A domain or URL.
 * @param opts - Country, how many, the workspace.
 * @param opts.country - Two-letter code or a place.
 * @param opts.limit - How many (most traffic first).
 * @param opts.orgId - Whose Ahrefs.
 * @param opts.today - The date to report on (a test seam).
 */
export async function ahrefsOrganicKeywords(target: string, opts: { country?: string; limit?: number; orgId?: string; today?: Date }): Promise<{ target: string; country: string; date: string; keywords: AhrefsOrganicKeyword[] }> {
  const key = await keyFor(opts.orgId);
  const country = ahrefsCountry(opts.country);
  const date = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const host = domainOf(target.includes('://') ? target : `https://${target}`) || target;
  const rows = await get<AhrefsOrganicRow>('/site-explorer/organic-keywords', {
    target: host,
    country,
    date,
    mode: 'subdomains',
    select: 'keyword,volume,keyword_difficulty,best_position,best_position_url,sum_traffic,cpc,serp_features',
    order_by: 'sum_traffic:desc',
    limit: String(Math.max(1, Math.min(500, opts.limit ?? 100))),
  }, key, 'keywords');
  return { target: host, country, date, keywords: ahrefsOrganicOf(rows) };
}

export type AhrefsAiAnswer = {
  question: string;
  answer: string;
  assistant: string | null;
  volume: number | null;
  links: string[];
  updated: string | null;
};

/**
 * Brand Radar rows in a plain shape: the question, the start of the
 * answer, the assistant, the links it cited. Pure.
 * @param rows - Ahrefs' rows.
 */
export function ahrefsAiAnswersOf(rows: AhrefsAiResponseRow[]): AhrefsAiAnswer[] {
  return rows.filter(r => r.question).map(r => ({
    question: r.question!,
    answer: (r.response ?? '').slice(0, 600),
    assistant: r.data_source ?? null,
    volume: r.volume ?? null,
    links: (r.links ?? []).map(l => (typeof l === 'string' ? l : l.url ?? '')).filter(Boolean).slice(0, 10),
    updated: r.last_updated ?? null,
  }));
}

/** The AI assistants Brand Radar reads, by Ahrefs' names. */
export const BRAND_RADAR_SOURCES = ['google_ai_overviews', 'google_ai_mode', 'chatgpt', 'perplexity', 'gemini', 'copilot'] as const;

/**
 * The AI answers that mention a brand (Brand Radar → AI responses).
 * @param brand - The brand, as people name it.
 * @param opts - Competitors, assistant, country, how many, the workspace.
 * @param opts.competitors - Competitor brands.
 * @param opts.source - Which assistant.
 * @param opts.country - Two-letter code or a place.
 * @param opts.limit - How many.
 * @param opts.orgId - Whose Ahrefs.
 */
export async function ahrefsBrandRadar(brand: string, opts: { competitors?: string[]; source?: typeof BRAND_RADAR_SOURCES[number]; country?: string; limit?: number; orgId?: string }): Promise<{ brand: string; assistant: string; answers: AhrefsAiAnswer[]; checkedAt: string }> {
  const key = await keyFor(opts.orgId);
  const source = opts.source ?? 'google_ai_overviews';
  const rows = await get<AhrefsAiResponseRow>('/brand-radar/ai-responses', {
    select: 'question,response,data_source,volume,links,last_updated',
    data_source: source,
    brand,
    ...(opts.competitors?.length ? { competitors: opts.competitors.join(',') } : {}),
    ...(opts.country ? { country: ahrefsCountry(opts.country) } : {}),
    order_by: 'volume',
    limit: String(Math.max(1, Math.min(100, opts.limit ?? 25))),
  }, key, 'ai_responses');
  return { brand, assistant: source, answers: ahrefsAiAnswersOf(rows), checkedAt: new Date().toISOString() };
}
