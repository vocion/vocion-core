/**
 * The Paid Marketing app's lists as data: how a campaign or a search term sorts,
 * and how its numbers read. Pure, so the tables and their tests agree.
 */

import type { CampaignRow, SearchTermRow } from '@/services/marketing/marketingReads';

export const CAMPAIGN_SORTS = ['name', 'spend', 'clicks', 'ctr', 'cpc', 'conversions', 'cpa'] as const;
export type CampaignSort = typeof CAMPAIGN_SORTS[number];

export const TERM_SORTS = ['term', 'spend', 'clicks', 'conversions'] as const;
export type TermSort = typeof TERM_SORTS[number];

/** A first click on a heading sorts names A–Z and money and counts biggest first. */
const FIRST: Record<CampaignSort | TermSort, 'asc' | 'desc'> = { name: 'asc', term: 'asc', spend: 'desc', clicks: 'desc', ctr: 'desc', cpc: 'desc', conversions: 'desc', cpa: 'asc' };

/**
 * The sort after a heading is clicked: the same heading reverses, another starts at its natural direction.
 * @param current - The sort now.
 * @param current.sort - Its key.
 * @param current.dir - Its direction.
 * @param clicked - The heading clicked.
 */
export function nextSort<K extends CampaignSort | TermSort>(current: { sort: K; dir: 'asc' | 'desc' }, clicked: K): { sort: K; dir: 'asc' | 'desc' } {
  return current.sort === clicked ? { sort: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { sort: clicked, dir: FIRST[clicked] };
}

function compare(a: number | string | null, b: number | string | null, dir: 'asc' | 'desc'): number {
  // Nothing to compare (no clicks, so no CPC) always sorts last.
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  const n = typeof a === 'string' ? a.localeCompare(String(b), undefined, { sensitivity: 'base' }) : a - (b as number);
  return dir === 'asc' ? n : -n;
}

/**
 * Campaigns in the order asked.
 * @param rows - The campaigns.
 * @param sort - The key.
 * @param dir - The direction.
 */
export function sortCampaigns(rows: readonly CampaignRow[], sort: CampaignSort, dir: 'asc' | 'desc'): CampaignRow[] {
  const key = (r: CampaignRow): number | string | null => sort === 'name' ? r.name : sort === 'cpa' ? r.costPerConversion : r[sort];
  return [...rows].sort((a, b) => compare(key(a), key(b), dir) || a.name.localeCompare(b.name));
}

/**
 * Search terms in the order asked.
 * @param rows - The terms.
 * @param sort - The key.
 * @param dir - The direction.
 */
export function sortTerms(rows: readonly SearchTermRow[], sort: TermSort, dir: 'asc' | 'desc'): SearchTermRow[] {
  return [...rows].sort((a, b) => compare(a[sort], b[sort], dir) || a.term.localeCompare(b.term));
}

/**
 * Money as a person reads it: "$1,240", "$3.42".
 * @param n - The amount, or null when there is none.
 */
export function money(n: number | null): string {
  if (n === null) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
}

/**
 * A rate as a percentage with one decimal: "4.2%".
 * @param r - 0..1, or null.
 */
export function percent(r: number | null): string {
  return r === null ? '—' : `${(r * 100).toFixed(1)}%`;
}

/**
 * Totals across campaigns, with the rates computed from the totals rather than averaged.
 * @param rows - The campaigns.
 */
export function totalsOf(rows: readonly CampaignRow[]): { spend: number; clicks: number; impressions: number; conversions: number; cpc: number | null; costPerConversion: number | null } {
  const spend = Math.round(rows.reduce((s, r) => s + r.spend, 0) * 100) / 100;
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const conversions = Math.round(rows.reduce((s, r) => s + r.conversions, 0) * 100) / 100;
  return { spend, clicks, impressions, conversions, cpc: clicks > 0 ? Math.round(spend / clicks * 100) / 100 : null, costPerConversion: conversions > 0 ? Math.round(spend / conversions * 100) / 100 : null };
}
