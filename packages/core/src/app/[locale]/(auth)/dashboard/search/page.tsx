import { ExternalLink, Search as SearchIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { search } from '@/libs/onyx/client';

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
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await props.params;
  const { q } = await props.searchParams;
  setRequestLocale(locale);

  const query = (q ?? '').trim();
  let results: SearchDoc[] = [];
  let error: string | null = null;

  if (query) {
    try {
      const data = await search({ query });
      results = (data?.top_documents ?? data?.documents ?? []) as SearchDoc[];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <>
      <TitleBar
        title="Search"
        description="Hybrid retrieval across every connected Source. pgvector + Postgres FTS with reciprocal rank fusion — same pipeline your Agents use."
      />

      <form method="get" className="mb-6">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-primary/50">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search transcripts, docs, CRM records…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="submit"
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
        </div>
      </form>

      {!query && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Enter a query above. Results are ranked by hybrid vector + keyword relevance, with source system and relevance score shown per hit.
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
          No results for
          {' '}
          <span className="font-mono">
            "
            {query}
            "
          </span>
          .
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {results.length}
            {' '}
            results · ranked by hybrid score
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
