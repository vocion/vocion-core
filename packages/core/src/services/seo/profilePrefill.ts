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

/** Reach, not a place: never read as where a local client serves. */
const NOT_A_PLACE = /^(?:worldwide|global|international|online|remote|everywhere|north america|europe|emea|apac|latam|us|usa|united states|uk|united kingdom|canada)(?:, (?:global|worldwide))?$/i;

/** The home page's text kept for reading what the business is. */
const HOME_TEXT_CAP = 8000;

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
      // "Worldwide" or a region is reach, not a place a client serves in person.
      if (!NOT_A_PLACE.test(p)) {
        places.add(p);
      }
    }
  }
  const hasStreetAddress = nodes.some((n) => {
    const a = n.address as Record<string, unknown> | undefined;
    return Boolean(a && typeof a === 'object' && typeof a.streetAddress === 'string' && a.streetAddress.trim());
  });
  const lang = $('html').attr('lang')?.trim() || null;
  return {
    homepage: url,
    lang,
    title: facts.title,
    description: facts.metaDescription,
    schemaTypes: [...new Set([...facts.schemaTypes, ...nodes.flatMap(typesOf)])],
    places: [...places].slice(0, 20),
    text: facts.text.slice(0, HOME_TEXT_CAP),
    hasStreetAddress,
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

/** What the home page's structured data says about the business, for the audit's AI-visibility and local checks. */
export type HomepageSchema = {
  /** Organization-like types declared (Organization, LocalBusiness and its subtypes, Corporation). */
  orgTypes: string[];
  /** The Organization's own `description`, as written. */
  orgDescription: string | null;
  /** The Organization's `name`. */
  orgName: string | null;
  /** What its `knowsAbout` lists. */
  knowsAbout: string[];
  /** Profiles its `sameAs` links. */
  sameAs: number;
  telephone: string | null;
  /** An address with a street or locality. */
  hasAddress: boolean;
};

const ORG_TYPE = /^(?:Organization|Corporation|LocalBusiness|OnlineBusiness|OnlineStore|ProfessionalService|NGO|EducationalOrganization|MedicalOrganization)$|Business$|Service$|Store$|Contractor$|Plumber$|Electrician$|Dentist$|Attorney$|Restaurant$|Locksmith$/;

/**
 * The home page's Organization schema, read. Pure.
 * @param html - The home page as served.
 */
export function homepageSchema(html: string): HomepageSchema {
  const $ = load(html);
  const nodes = jsonLdNodes($).filter(n => typesOf(n).some(t => ORG_TYPE.test(t)));
  const str = (k: string) => {
    for (const n of nodes) {
      const v = n[k];
      if (typeof v === 'string' && v.trim()) {
        return v.trim();
      }
    }
    return null;
  };
  const sameAs = nodes.flatMap(n => (Array.isArray(n.sameAs) ? n.sameAs : typeof n.sameAs === 'string' ? [n.sameAs] : [])).length;
  const hasAddress = nodes.some((n) => {
    const a = n.address as Record<string, unknown> | string | undefined;
    return typeof a === 'string' ? a.trim().length > 0 : Boolean(a && (a.streetAddress || a.addressLocality));
  });
  const knowsAbout = nodes.flatMap((n) => {
    const k = n.knowsAbout;
    const list = Array.isArray(k) ? k : k === undefined ? [] : [k];
    return list.map(v => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : '')).filter(Boolean);
  });
  return { orgTypes: [...new Set(nodes.flatMap(typesOf))], orgDescription: str('description'), orgName: str('name'), knowsAbout: [...new Set(knowsAbout)], sameAs, telephone: str('telephone'), hasAddress };
}
