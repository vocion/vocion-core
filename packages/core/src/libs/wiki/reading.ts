/**
 * The wiki as a person READS it — pure functions over the pages, shared by
 * the `wiki` page archetype's server route and its view.
 *
 * A wiki is not a table of artifacts. It is a set of pages in a reading
 * order, with a home, with links between pages that resolve to pages, and
 * with one page open at a time beside the list of the others. Everything
 * here exists to turn a folder of markdown artifacts into that: the order,
 * the home, the neighbours, and the link rewriting that makes `/wiki/<slug>.md`
 * (the path every agent sees the wiki mounted at) open the page in the app.
 */

export type WikiReadingPage = {
  id: number;
  slug: string;
  title: string;
  /** One line the rail and the home show; the first paragraph when none was set. */
  summary: string;
  /** The page body, markdown. Empty on rail entries the route did not load in full. */
  md: string;
  /** The seeded reading order, when the repo set one. */
  order: number | null;
  tags: string[];
  version: number;
  updatedAt: Date;
  lastAuthorKind: string;
};

/** The slugs a wiki treats as its front page, in order of preference. */
export const WIKI_HOME_SLUGS = ['index', 'home'] as const;

/**
 * The front page, if the wiki has one it wrote itself.
 * @param pages - Every page.
 */
export function wikiHome(pages: readonly WikiReadingPage[]): WikiReadingPage | null {
  for (const slug of WIKI_HOME_SLUGS) {
    const hit = pages.find(p => p.slug === slug);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/**
 * Reading order: the home first, then the seeded `order`, then the title.
 * A page with no order sorts after every page that has one — the repo's
 * numbering is the author's intent and an unnumbered page is an appendix.
 * @param pages - Every page.
 */
export function orderWikiPages(pages: readonly WikiReadingPage[]): WikiReadingPage[] {
  const home = wikiHome(pages);
  const rest = pages.filter(p => p !== home);
  rest.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) {
      return ao - bo;
    }
    return a.title.localeCompare(b.title);
  });
  return home ? [home, ...rest] : rest;
}

/**
 * The pages grouped by their first tag, in reading order, for a home page
 * that has to be generated. Untagged pages sit under no heading, first.
 * @param pages - Every page, already ordered.
 */
export function wikiSections(pages: readonly WikiReadingPage[]): Array<{ tag: string | null; pages: WikiReadingPage[] }> {
  const out: Array<{ tag: string | null; pages: WikiReadingPage[] }> = [];
  for (const page of pages) {
    if (WIKI_HOME_SLUGS.includes(page.slug as typeof WIKI_HOME_SLUGS[number])) {
      continue;
    }
    const tag = page.tags[0] ?? null;
    const section = out.find(s => s.tag === tag);
    if (section) {
      section.pages.push(page);
    } else {
      out.push({ tag, pages: [page] });
    }
  }
  out.sort((a, b) => (a.tag === null ? -1 : b.tag === null ? 1 : 0));
  return out;
}

/**
 * The page before and after this one in reading order, for the footer.
 * @param ordered - Every page, in reading order.
 * @param slug - The open page.
 */
export function wikiNeighbours(ordered: readonly WikiReadingPage[], slug: string): { prev: WikiReadingPage | null; next: WikiReadingPage | null } {
  const i = ordered.findIndex(p => p.slug === slug);
  if (i === -1) {
    return { prev: null, next: null };
  }
  return { prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null };
}

const WIKI_MOUNT_RE = /^(?:\/wiki\/)?([a-z][a-z0-9-]{0,79})\.md(#.*)?$/i;
const ARTIFACT_ROUTE_RE = /^\/dashboard\/artifacts\/(\d+)(#.*)?$/;

/**
 * Where a link in a page should go. A page written by an agent links to
 * other pages the way the agent sees them — `/wiki/<slug>.md`, the mount
 * path — or to `/dashboard/artifacts/<id>`, the row the old table opened.
 * Both are pages; both open as pages. Anything else is left alone.
 * @param href - The link as written.
 * @param pages - Every page, so an id or a slug can be recognised.
 * @param base - The wiki route, e.g. `/dashboard/p/wiki`.
 */
export function rewriteWikiLink(href: string, pages: readonly WikiReadingPage[], base: string): string {
  const mount = WIKI_MOUNT_RE.exec(href);
  if (mount) {
    const slug = mount[1]!.toLowerCase();
    if (pages.some(p => p.slug === slug)) {
      return `${base}/${slug}${mount[2] ?? ''}`;
    }
    return href;
  }
  const artifact = ARTIFACT_ROUTE_RE.exec(href);
  if (artifact) {
    const page = pages.find(p => p.id === Number(artifact[1]));
    return page ? `${base}/${page.slug}${artifact[2] ?? ''}` : href;
  }
  return href;
}

/**
 * Pages whose title or summary contains every word of the query — the rail's
 * filter. Empty query, every page.
 * @param pages - Pages in reading order.
 * @param query - What was typed.
 */
export function filterWikiPages(pages: readonly WikiReadingPage[], query: string): WikiReadingPage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...pages];
  }
  return pages.filter((p) => {
    const hay = `${p.title} ${p.summary} ${p.tags.join(' ')}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
