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
  searchParams: Promise<{ q?: string; source?: string }>;
}) {
  const { locale } = await props.params;
  const { q, source } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();

  const query = (q ?? '').trim();
  const sourceFilter = (source ?? '').trim() || undefined;

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
    const recent = await listRecentDocuments(orgId, { sourceSlug: sourceFilter, limit: 25, allowedSourceSlugs });
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
      />
    </ListPage>
  );
}
