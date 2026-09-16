'use client';

import { useCallback, useEffect, useState } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListToolbar, Subline } from '@/components/patterns';
import { usePathname, useRouter } from '@/libs/I18nNavigation';

/**
 * The Search list — the List archetype against hybrid retrieval.
 *
 * Search is a server round-trip (pgvector + FTS with reciprocal rank fusion
 * runs on the server), so unlike the client-filtered lists this toolbar
 * navigates: every control writes `?q=` / `?source=` and the page re-renders
 * with the ranked set. The shape is the same as every other list — one title,
 * one context line, ONE row of chips with "+N more", hairline rows in the
 * artifacts density. Only the data is different.
 */

export type SearchResult = {
  id: string;
  title: string;
  sourceSlug: string | null;
  /** External link at the connector, when the document carries one. */
  link: string | null;
  blurb: string | null;
  score: number | null;
  updatedAt: string | null;
  /** Whether this result is an ingested document we can open on its own page. */
  openable: boolean;
};

export type SourceChipData = { slug: string; count: number };

/** Fixed locale + UTC so the server render and the client render agree. */
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function dateLabel(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

export function SearchResults(props: {
  query: string;
  source: string | null;
  sources: readonly SourceChipData[];
  results: readonly SearchResult[];
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { query, source, sources, results, error } = props;
  const [q, setQ] = useState(query);
  // The prop is the truth: a back button or a chip click re-renders the server
  // page, and the box must follow rather than keep the last thing typed. React
  // calls this "adjusting state while rendering" — cheaper than an effect,
  // because the stale box never reaches the screen.
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    setQ(query);
  }

  const go = useCallback((next: { q?: string; source?: string | null }) => {
    const params = new URLSearchParams();
    const nq = (next.q ?? q).trim();
    const ns = next.source === undefined ? source : next.source;
    if (nq) {
      params.set('q', nq);
    }
    if (ns) {
      params.set('source', ns);
    }
    const s = params.toString();
    router.push(`${pathname}${s ? `?${s}` : ''}`);
  }, [q, source, router, pathname]);

  // Debounced: typing searches without a submit, the way every other list
  // filters, but never once per keystroke against the retrieval pipeline.
  const onSearchChange = useCallback((value: string) => {
    setQ(value);
  }, []);
  useEffect(() => {
    if (q === query) {
      return;
    }
    const t = setTimeout(() => go({ q }), 350);
    return () => clearTimeout(t);
  }, [q, query, go]);

  const total = sources.reduce((n, s) => n + s.count, 0);

  return (
    <>
      <ListToolbar
        search={{
          value: q,
          onChange: onSearchChange,
          placeholder: 'Search transcripts, docs, CRM records…',
          label: 'Search the corpus',
        }}
        trailing={(
          <span className="text-xs text-muted-foreground tabular-nums">
            {query
              ? `${results.length} ranked`
              : `${total.toLocaleString()} documents`}
          </span>
        )}
        chips={sources.length > 0
          ? {
              items: sources.map(s => ({ key: s.slug, label: s.slug, count: s.count })),
              active: source ? [source] : [],
              // One connector at a time: the retrieval filter takes one
              // `source_type`, so a second click replaces rather than adds.
              onChange: next => go({ source: next.find(k => k !== source) ?? null }),
              label: 'Filter by connector',
            }
          : undefined}
      />

      {error
        ? (
            <p role="alert" className="py-10 text-center text-sm text-brand-fail">
              {`Search failed: ${error}`}
            </p>
          )
        : results.length === 0
          ? (
              <ListEmpty
                variant="inline"
                title={query
                  ? `No results for “${query}”${source ? ` in ${source}` : ''}.`
                  : 'No documents ingested yet.'}
                description={query
                  ? 'Try fewer words, or clear the connector filter.'
                  : 'Connect a source on the Sources page and sync it, then browse or search here.'}
              />
            )
          : (
              <ListRows className="mt-1">
                {results.map(r => (
                  <ListRow
                    key={r.id}
                    data-testid="search-result"
                    href={r.openable ? `/dashboard/search/${r.id}` : undefined}
                    title={r.title}
                    subline={(
                      <Subline
                        separator="·"
                        segments={[r.sourceSlug, dateLabel(r.updatedAt), r.blurb]}
                      />
                    )}
                    columns={r.score !== null && (
                      <Column kind="score" mono>{r.score.toFixed(3)}</Column>
                    )}
                  />
                ))}
              </ListRows>
            )}
    </>
  );
}
