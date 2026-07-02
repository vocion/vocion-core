import { ExternalLink, Search as SearchIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
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
  boost?: number;
  updated_at?: string;
};

export default async function SearchPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; source?: string }>;
}) {
  const { locale } = await props.params;
  const { q, source } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const query = (q ?? '').trim();
  const sourceFilter = (source ?? '').trim() || undefined;

  // Filter chips: every source that actually has documents, with counts.
  let chips: Array<{ slug: string; count: number }> = [];
  if (orgId) {
    const [sources, counts] = await Promise.all([listSources(orgId), documentCountsForOrg(orgId)]);
    chips = sources
      .map(s => ({ slug: s.slug, count: counts[s.id] ?? 0 }))
      .filter(s => s.count > 0)
      .sort((a, b) => b.count - a.count);
  }
  const totalDocs = chips.reduce((n, c) => n + c.count, 0);

  let results: SearchDoc[] = [];
  let error: string | null = null;

  if (query) {
    try {
      const data = await searchLegacyShape({
        query,
        search_filters: sourceFilter ? { source_type: [sourceFilter] } : undefined,
      });
      results = (data?.top_documents ?? data?.results ?? []) as SearchDoc[];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (orgId) {
    // Default result set: the most recent documents across the corpus —
    // browse before you search, filterable by source.
    const recent = await listRecentDocuments(orgId, { sourceSlug: sourceFilter, limit: 25 });
    results = recent.map(r => ({
      document_id: String(r.id),
      semantic_identifier: r.title ?? `document ${r.id}`,
      source_type: r.sourceSlug,
      link: r.uri ?? undefined,
      blurb: r.blurb ?? undefined,
      updated_at: r.updatedAt ? r.updatedAt.toISOString() : undefined,
    }));
  }

  const filterHref = (slug?: string) => {
    const params = new URLSearchParams();
    if (query) {
      params.set('q', query);
    }
    if (slug) {
      params.set('source', slug);
    }
    const s = params.toString();
    return `/dashboard/search${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <TitleBar
        title="Search"
        description="Hybrid retrieval across every connected Source. pgvector + Postgres FTS with reciprocal rank fusion — same pipeline your Agents use."
      />

      <form method="get" className="mb-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-primary/50">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search transcripts, docs, CRM records…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          {sourceFilter && <input type="hidden" name="source" value={sourceFilter} />}
          <button
            type="submit"
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
        </div>
      </form>

      {chips.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <a
            href={filterHref(undefined)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${!sourceFilter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
          >
            {`All · ${totalDocs.toLocaleString()}`}
          </a>
          {chips.map(c => (
            <a
              key={c.slug}
              href={filterHref(c.slug)}
              className={`rounded-full border px-2.5 py-1 font-mono text-xs transition ${sourceFilter === c.slug ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
            >
              {`${c.slug} · ${c.count.toLocaleString()}`}
            </a>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Search failed:
          {' '}
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      {query && !error && results.length === 0 && (
        <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
          {`No results for "${query}"${sourceFilter ? ` in ${sourceFilter}` : ''}.`}
        </div>
      )}

      {!query && !error && results.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No documents ingested yet — connect a source on the Sources page and sync it, then browse or search here.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {query
              ? `${results.length} results · ranked by hybrid score`
              : `Most recent ${results.length} documents${sourceFilter ? ` · ${sourceFilter}` : ' · all sources'}`}
          </div>
          {results.map((doc, i) => {
            const title = doc.semantic_identifier || doc.document_id || 'Untitled';
            const score = typeof doc.score === 'number' ? doc.score : null;
            return (
              <div key={`${doc.document_id ?? i}`} className="rounded-lg border border-border bg-background p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {doc.link
                        ? (
                            <a href={doc.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline">
                              {title}
                              <ExternalLink className="size-3 text-muted-foreground" />
                            </a>
                          )
                        : (
                            <span className="text-sm font-medium">{title}</span>
                          )}
                    </div>
                    {doc.source_type && (
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="font-mono text-[10px]">{doc.source_type}</Badge>
                        {doc.updated_at && <span>{new Date(doc.updated_at).toLocaleDateString()}</span>}
                      </div>
                    )}
                  </div>
                  {score !== null && (
                    <div className="text-right">
                      <div className="font-mono text-sm tabular-nums">{score.toFixed(3)}</div>
                      <div className="text-[10px] text-muted-foreground">score</div>
                    </div>
                  )}
                </div>
                {doc.blurb && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{doc.blurb}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
