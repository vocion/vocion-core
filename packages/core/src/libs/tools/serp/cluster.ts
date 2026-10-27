/**
 * Keyword clustering by what Google ranks: two keywords whose top tens share
 * three or more URLs are answered by the same pages, so they belong on one
 * page of ours. Planning two pages for them makes the two compete with each
 * other; planning one page for keywords Google answers differently leaves
 * one of them unanswered.
 *
 * Pure: it reads results pages already fetched (`serp_search`), so it needs
 * no search volume and every grouping can be checked against the URLs that
 * produced it.
 */

/** Shared top-ten URLs that put two keywords on one page. */
export const SHARED_URLS_FOR_ONE_PAGE = 3;

/**
 * A URL reduced to the page it names: no scheme, `www.`, query, fragment or
 * trailing slash; host lower case.
 * @param url - The URL.
 */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export type KeywordSerp = { keyword: string; urls: string[] };

export type ClusterMember = {
  keyword: string;
  /** Top-ten URLs it shares with the cluster's head (the head shares all its own). */
  sharedWithHead: number;
  sharedUrls: string[];
};

export type KeywordCluster = {
  /** The keyword the cluster formed around: the first of them as given. */
  head: string;
  members: ClusterMember[];
};

/**
 * Group keywords whose top tens share at least `minShared` URLs. Keywords are
 * taken in the order given; each joins the cluster whose head it shares the
 * most URLs with, at least `minShared`, or starts its own. Comparing against
 * the head rather than any member keeps a chain (A shares with B, B with C,
 * C nothing with A) from collapsing into one page.
 * @param serps - Each keyword's ranking URLs, best first.
 * @param opts - Options.
 * @param opts.minShared - Shared URLs that make one page (default 3).
 * @param opts.top - How many results of each page count (default 10).
 */
export function clusterKeywords(serps: KeywordSerp[], opts: { minShared?: number; top?: number } = {}): KeywordCluster[] {
  const minShared = opts.minShared ?? SHARED_URLS_FOR_ONE_PAGE;
  const top = opts.top ?? 10;
  const heads: Array<{ cluster: KeywordCluster; keys: Map<string, string> }> = [];
  const seen = new Set<string>();
  for (const s of serps) {
    const norm = s.keyword.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!norm || seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    const keys = new Map<string, string>();
    for (const url of s.urls.slice(0, top)) {
      const k = pageKey(url);
      if (!keys.has(k)) {
        keys.set(k, url);
      }
    }
    let best: { entry: (typeof heads)[number]; shared: string[] } | null = null;
    for (const entry of heads) {
      const shared = [...keys.keys()].filter(k => entry.keys.has(k)).map(k => entry.keys.get(k)!);
      if (shared.length >= minShared && (!best || shared.length > best.shared.length)) {
        best = { entry, shared };
      }
    }
    if (best) {
      best.entry.cluster.members.push({ keyword: s.keyword.trim(), sharedWithHead: best.shared.length, sharedUrls: best.shared });
    } else {
      heads.push({ cluster: { head: s.keyword.trim(), members: [{ keyword: s.keyword.trim(), sharedWithHead: keys.size, sharedUrls: [] }] }, keys });
    }
  }
  return heads.map(h => h.cluster);
}
