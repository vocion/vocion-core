import type { SearchResult, SourceChipData } from '@/features/search/SearchResults';
import { setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { SearchResults } from '@/features/search/SearchResults';
import { clerkAuth as auth } from '@/libs/Auth';
import { searchLegacyShape } from '@/libs/retrieval/legacyDocument';
import { documentCountsForOrg, listRecentDocuments, listSources } from '@/services/SourceSyncService';

type SearchDoc = {
  document_id?: string;
  semantic_identifier?: string;
  source_type?: string;
  link?: string;
  blurb?: string;
  score?: number;
  updated_at?: string;
};

/**
 * Search — the List archetype against hybrid retrieval. This file reads; the
 * list itself is `features/search/SearchResults`, and a result opens on
 * `/dashboard/search/[documentId]`.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function SearchPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; source?: string; n?: string }>;
}) {
  const { locale } = await props.params;
  const { q, source, n } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();

  const query = (q ?? '').trim();
  const sourceFilter = (source ?? '').trim() || undefined;

  // Paging lives in the URL, because search here is already a server
  // round-trip and the toolbar already navigates. A longer result set then
  // survives a reload, a back button and a shared link — none of which client
  // state would have given us.
  const PAGE = 25;
  const MAX = 200;
  const requested = Number.parseInt(n ?? '', 10);
  const pageSize = Math.min(Number.isFinite(requested) && requested > 0 ? requested : PAGE, MAX);
  // Ask for one more than we render: if it comes back, there is another page,
  // and we never have to count the whole corpus to find that out.
  const probe = Math.min(pageSize + 1, MAX + 1);

  // Filter chips: every source that actually has documents, with counts.
  let sources: SourceChipData[] = [];
  if (orgId) {
    const [rows, counts] = await Promise.all([listSources(orgId), documentCountsForOrg(orgId)]);
    sources = rows
      .map(s => ({ slug: s.slug, count: counts[s.id] ?? 0 }))
      .filter(s => s.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  let results: SearchResult[] = [];
  let error: string | null = null;

  const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
  const allowedSourceSlugs = orgId && userId ? await allowedSourceSlugsForUser(orgId, userId) : undefined;

  if (query) {
    try {
      const data = await searchLegacyShape({
        query,
        search_filters: sourceFilter ? { source_type: [sourceFilter] } : undefined,
        allowedSourceSlugs,
        limit: probe,
      });
      const docs = (data?.top_documents ?? data?.results ?? []) as SearchDoc[];
      results = docs.map((d, i) => ({
        id: d.document_id ?? String(i),
        title: d.semantic_identifier || d.document_id || 'Untitled',
        sourceSlug: d.source_type ?? null,
        link: d.link ?? null,
        blurb: d.blurb ?? null,
        score: typeof d.score === 'number' ? d.score : null,
        updatedAt: d.updated_at ?? null,
        // Only a numeric `knowledge_document.id` has a page to open.
        openable: /^\d+$/.test(d.document_id ?? ''),
      }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (orgId) {
    // Default result set: the most recent documents across the corpus —
    // browse before you search, filterable by connector.
    const recent = await listRecentDocuments(orgId, { sourceSlug: sourceFilter, limit: probe, allowedSourceSlugs });
    results = recent.map(r => ({
      id: String(r.id),
      title: r.title ?? `document ${r.id}`,
      sourceSlug: r.sourceSlug,
      link: r.uri ?? null,
      blurb: r.blurb ?? null,
      score: null,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      openable: true,
    }));
  }

  const hasMore = results.length > pageSize;
  if (hasMore) {
    results = results.slice(0, pageSize);
  }
  const moreParams = new URLSearchParams();
  if (query) {
    moreParams.set('q', query);
  }
  if (sourceFilter) {
    moreParams.set('source', sourceFilter);
  }
  moreParams.set('n', String(Math.min(pageSize + PAGE, MAX)));

  return (
    <ListPage
      title="Search"
      description="Hybrid retrieval across every connected connector — pgvector and Postgres full-text with reciprocal rank fusion, the same pipeline your agents use."
    >
      <SearchResults
        query={query}
        source={sourceFilter ?? null}
        sources={sources}
        results={results}
        error={error}
        hasMore={hasMore}
        moreHref={`/dashboard/search?${moreParams.toString()}`}
      />
    </ListPage>
  );
}
