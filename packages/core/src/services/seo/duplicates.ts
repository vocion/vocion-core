/**
 * Doorway pages, caught in code: a location page that is a sibling location
 * page with the city name swapped. Search engines treat a set of those as
 * doorway pages and demote the lot, and a person reviewing one page at a time
 * never sees it, because each page reads fine on its own.
 *
 * The check is deterministic: both drafts reduced to plain words, every
 * city name (theirs and ours) masked to one token so swapping it changes
 * nothing, then the Jaccard share of five-word shingles. At 0.7 or more the
 * editor's review fails the page (`seo_save_review`), whatever verdict the
 * editor gave, and says which sibling and how similar.
 */

import { jaccard, shingles, words } from '@/libs/tools/serp/textMatch';

/** At this share of shared five-word runs, two location pages are one page with the name swapped. */
export const LOCATION_PAGE_SIMILARITY_LIMIT = 0.7;

/** Words per shingle. */
const SHINGLE = 5;

/**
 * A markdown draft as the words a reader reads: links reduced to their text,
 * markup, tables' pipes, HTML comments and code fences gone.
 * @param md - The draft.
 */
export function bodyText(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The names a location goes by in running text: "Fairview, OR" is also
 * "Fairview".
 * @param location - The page's location.
 */
function namesOf(location: string | undefined): string[] {
  if (!location?.trim()) {
    return [];
  }
  const full = location.trim();
  const first = full.split(',')[0]!.trim();
  return [...new Set([full, first].filter(n => n.length >= 2))].sort((a, b) => b.length - a.length);
}

/**
 * The text with every given place name replaced by one placeholder word.
 * @param text - Plain text.
 * @param places - Locations to mask.
 */
export function maskPlaces(text: string, places: Array<string | undefined>): string {
  let out = text;
  for (const name of [...new Set(places.flatMap(namesOf))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu'), ' placename ');
  }
  return out;
}

export type LocationDraft = { pageId: number; keyword: string; location?: string; markdown: string };

/**
 * How alike two location pages are once their place names are masked, 0 to 1.
 * @param a - One draft.
 * @param b - The other.
 */
export function locationPageSimilarity(a: Pick<LocationDraft, 'location' | 'markdown'>, b: Pick<LocationDraft, 'location' | 'markdown'>): number {
  const places = [a.location, b.location];
  return jaccard(shingles(maskPlaces(bodyText(a.markdown), places), SHINGLE), shingles(maskPlaces(bodyText(b.markdown), places), SHINGLE));
}

export type NearDuplicate = { pageId: number; keyword: string; location?: string; similarity: number };

/**
 * The sibling location pages a draft is too similar to, most similar first.
 * @param draft - The draft under review.
 * @param siblings - The other location pages' drafts in the same batch.
 * @param limit - The similarity that fails it (default 0.7).
 */
export function nearDuplicates(draft: LocationDraft, siblings: LocationDraft[], limit = LOCATION_PAGE_SIMILARITY_LIMIT): NearDuplicate[] {
  return siblings
    .filter(s => s.pageId !== draft.pageId)
    .map(s => ({ pageId: s.pageId, keyword: s.keyword, ...(s.location ? { location: s.location } : {}), similarity: Math.round(locationPageSimilarity(draft, s) * 100) / 100 }))
    .filter(s => s.similarity >= limit)
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Whether a query names a location: the location's first name ("Fairview" of
 * "Fairview, OR") appears in it as a phrase, case, accents and punctuation
 * aside.
 * @param query - The search query.
 * @param location - The page's location.
 */
export function queryNamesLocation(query: string, location: string): boolean {
  const q = ` ${words(query).join(' ')} `;
  const first = words(location.split(',')[0] ?? '').join(' ');
  return first.length > 0 && q.includes(` ${first} `);
}
