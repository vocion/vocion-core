/**
 * What a client's own site says about it, read for the SEO profile's
 * prefill (`profile.ts` `prefillSeoProfile`): the home page's language, title,
 * description, schema.org types and the places its schema names, and every
 * URL the site inventory listed. Read, never inferred: a page that states no
 * language has none here. Pure over the HTML and the inventory's markdown;
 * the tool does the fetching.
 */

import type { SiteSignals } from './profile';
import { load } from 'cheerio';
import { extractPageFacts, jsonLdNodes, typesOf } from '@/libs/tools/serp/pageFacts';

/**
 * A schema.org place as words: a string, or a node's `name`, or an address's
 * locality and region.
 * @param v - The value.
 */
function placeWords(v: unknown): string[] {
  if (typeof v === 'string') {
    return v.trim() ? [v.trim()] : [];
  }
  if (Array.isArray(v)) {
    return v.flatMap(placeWords);
  }
  if (v && typeof v === 'object') {
    const n = v as Record<string, unknown>;
    if (typeof n.addressLocality === 'string') {
      return [[n.addressLocality, typeof n.addressRegion === 'string' ? n.addressRegion : null].filter(Boolean).join(', ')];
    }
    if (typeof n.name === 'string') {
      return [n.name.trim()];
    }
  }
  return [];
}

/**
 * The home page's signals. Pure.
 * @param html - The home page as served.
 * @param url - Where it was read.
 */
export function homepageSignals(html: string, url: string): SiteSignals {
  const $ = load(html);
  const facts = extractPageFacts(html, url);
  const nodes = jsonLdNodes($);
  const places = new Set<string>();
  for (const node of nodes) {
    for (const p of [...placeWords(node.address), ...placeWords(node.areaServed)]) {
      places.add(p);
    }
  }
  const lang = $('html').attr('lang')?.trim() || null;
  return {
    homepage: url,
    lang,
    title: facts.title,
    description: facts.metaDescription,
    schemaTypes: [...new Set([...facts.schemaTypes, ...nodes.flatMap(typesOf)])],
    places: [...places].slice(0, 20),
  };
}

/**
 * Every URL a site inventory's markdown links, in order. Pure.
 * @param md - The inventory artifact's markdown (`renderInventory`).
 */
export function inventoryUrls(md: string): string[] {
  const seen = new Set<string>();
  for (const m of md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    seen.add(m[1]!);
  }
  return [...seen];
}
