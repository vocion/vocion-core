/**
 * THE WIKI IS SEARCHED, NOT HARD-CODED (Chris, 2026-09-29: "the Wiki should be
 * part of a rag lookup or context on major product decisions"). A ruling on
 * request #224 offered "Show with upsell" without anything checking it against
 * what the workspace had written down; the only page read was the one a gate
 * names. Every wiki page is indexed into the workspace's hybrid search under
 * one `wiki` source, on write and lazily on first use, and a product decision
 * gets the pages that bear on it by relevance — whichever pages those are.
 */

import type { SearchHit } from '@/services/RetrievalService';

/** The knowledge source every wiki page is indexed under. */
export const WIKI_SOURCE_SLUG = 'wiki';

/** A page, as a decision reads it. */
export type WikiPassage = { slug: string; title: string; excerpt: string; href: string | null };

/** Workspaces whose pages were all indexed in this process, and when. */
const indexedAt = new Map<string, number>();
const REINDEX_AFTER_MS = 10 * 60_000;

/**
 * Index one page for search. Best-effort: a page that fails to index is still
 * written, and the next lazy pass retries it.
 * @param orgId - The workspace.
 * @param page - The page.
 * @param page.slug
 * @param page.title
 * @param page.md
 * @param page.summary
 * @param page.artifactId
 */
export async function indexWikiPage(orgId: string, page: { slug: string; title: string; md: string; summary?: string | null; artifactId?: number | null }): Promise<void> {
  const { ensureSource, ingestDocument } = await import('@/services/IngestionService');
  const src = await ensureSource({ orgId, slug: WIKI_SOURCE_SLUG, kind: 'plugin', configJson: { internal: true, what: 'the workspace wiki' } });
  await ingestDocument(src, {
    externalId: `wiki:${page.slug}`,
    title: page.title,
    content: [`# ${page.title}`, page.summary?.trim(), page.md.trim()].filter(Boolean).join('\n\n'),
    uri: page.artifactId ? `/dashboard/artifacts/${page.artifactId}` : undefined,
    metadata: { slug: page.slug, kind: 'wiki' },
  });
}

/**
 * Index every page of the workspace, at most once per ten minutes per process.
 * @param orgId - The workspace.
 */
export async function ensureWikiIndexed(orgId: string): Promise<void> {
  const last = indexedAt.get(orgId);
  if (last && Date.now() - last < REINDEX_AFTER_MS) {
    return;
  }
  indexedAt.set(orgId, Date.now());
  const { listWikiPageRows, listWikiPages } = await import('./WikiService');
  const [pages, rows] = await Promise.all([listWikiPages(orgId), listWikiPageRows(orgId)]);
  const idBySlug = new Map(rows.map(r => [String((r.spec as { slug?: unknown } | null)?.slug ?? ''), r.id] as const));
  for (const p of pages) {
    await indexWikiPage(orgId, { slug: p.slug, title: p.title, md: p.md, summary: p.summary ?? null, artifactId: idBySlug.get(p.slug) ?? null }).catch((err: Error) => {
      console.warn('wiki index: a page failed to index', { orgId, slug: p.slug, message: err.message });
    });
  }
}

/**
 * The pages whose words best match, one passage each, most relevant first.
 * @param hits - Search hits under the wiki source.
 * @param k - How many pages.
 */
export function passagesFrom(hits: ReadonlyArray<Pick<SearchHit, 'content' | 'title' | 'uri' | 'score' | 'metadata'>>, k: number): WikiPassage[] {
  const seen = new Map<string, WikiPassage>();
  for (const h of [...hits].sort((a, b) => b.score - a.score)) {
    const slug = String(h.metadata?.slug ?? h.title ?? '');
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.set(slug, { slug, title: h.title ?? slug, excerpt: h.content.replace(/\s+/g, ' ').trim().slice(0, 700), href: h.uri });
    if (seen.size >= k) {
      break;
    }
  }
  return [...seen.values()];
}

/**
 * The wiki pages that bear on a decision, by relevance.
 * @param orgId - The workspace.
 * @param query - What is being decided, in its own words.
 * @param k - How many pages (default 3).
 */
export async function wikiContextFor(orgId: string, query: string, k = 3): Promise<WikiPassage[]> {
  if (!query.trim()) {
    return [];
  }
  await ensureWikiIndexed(orgId).catch(() => undefined);
  const { search } = await import('@/services/RetrievalService');
  const hits = await search(query.slice(0, 1_000), { orgId, userId: 'agent', mode: 'hybrid', k: k * 4, sourceSlugs: [WIKI_SOURCE_SLUG], rerank: false }).catch(() => [] as SearchHit[]);
  return passagesFrom(hits, k);
}

/**
 * The block a turn reads.
 * @param passages - The relevant pages.
 */
export function describeWikiContext(passages: readonly WikiPassage[]): string {
  if (passages.length === 0) {
    return '';
  }
  return [
    '--- what the workspace wiki says that bears on this (by relevance) ---',
    'A product decision (a request, its scope or acceptance, a plan, a ruling, the options offered) must fit these. Name the page when it decides a point; if the decision departs from one, say which and why.',
    ...passages.map(p => `- ${p.title} (wiki:${p.slug}${p.href ? `, ${p.href}` : ''}): ${p.excerpt}`),
  ].join('\n');
}
