/**
 * Who a business competes with on Google, read from results pages rather
 * than guessed: the domains that rank for two or more of its core searches,
 * with directories, marketplaces and the business itself left out. Each one
 * carries the searches it ranked for, at what position and with which page,
 * so the claim "X is a competitor" is checkable in one move (principle 10).
 *
 * Pure: the searches are made elsewhere (`serp_search`); this only reads them.
 */

import type { SerpResult } from './types';
import { isDirectoryDomain } from './directories';

/**
 * A host without its `www.`, lowercased.
 * @param domain - A domain or URL.
 */
function bareDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

export type Competitor = {
  domain: string;
  /** One entry per search it ranked for: its best position there. */
  ranked: Array<{ query: string; position: number; url: string }>;
};

export type CompetitorOptions = {
  /** The business's own domains: never its own competitor. */
  ownDomains?: readonly string[];
  /** Searches a domain must rank for to count. Default 2. */
  minSearches?: number;
  /** More domains to leave out, as directories are. */
  exclude?: readonly string[];
  /** Organic positions read per search. Default 10. */
  depth?: number;
};

/**
 * The competitors a set of results pages shows, most searches first, then
 * the better average position. Pure.
 * @param serps - The results pages, one per search.
 * @param opts - Own domains, threshold, exclusions.
 */
export function competitorsFromSerps(serps: ReadonlyArray<Pick<SerpResult, 'query' | 'organic'>>, opts: CompetitorOptions = {}): Competitor[] {
  const own = new Set((opts.ownDomains ?? []).map(bareDomain).filter(Boolean));
  const under = (set: Set<string>, d: string) => [...set].some(o => d === o || d.endsWith(`.${o}`));
  const isOwn = (d: string) => under(own, d);
  const excluded = new Set((opts.exclude ?? []).map(bareDomain).filter(Boolean));
  const depth = opts.depth ?? 10;
  const byDomain = new Map<string, Map<string, { query: string; position: number; url: string }>>();
  for (const serp of serps) {
    for (const r of serp.organic.filter(o => o.position <= depth)) {
      const domain = bareDomain(r.domain || r.url);
      if (!domain || isOwn(domain) || isDirectoryDomain(domain) || under(excluded, domain)) {
        continue;
      }
      const queries = byDomain.get(domain) ?? new Map();
      const held = queries.get(serp.query);
      // Two pages of one site on one search are one ranking: its best.
      if (!held || r.position < held.position) {
        queries.set(serp.query, { query: serp.query, position: r.position, url: r.url });
      }
      byDomain.set(domain, queries);
    }
  }
  const min = opts.minSearches ?? 2;
  const avg = (c: Competitor) => c.ranked.reduce((n, r) => n + r.position, 0) / c.ranked.length;
  return [...byDomain.entries()]
    .map(([domain, queries]) => ({ domain, ranked: [...queries.values()].sort((a, b) => a.position - b.position) }))
    .filter(c => c.ranked.length >= min)
    .sort((a, b) => b.ranked.length - a.ranked.length || avg(a) - avg(b) || a.domain.localeCompare(b.domain));
}
