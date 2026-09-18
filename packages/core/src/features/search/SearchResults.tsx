'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListToolbar, Subline } from '@/components/patterns';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { usePreviewList } from '@/features/preview/usePreviewList';
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
 *
 * **A row here is a reference, not the task.** You are scanning results to
 * find the right one, so a plain click PREVIEWS (`docs/design/patterns.md`
 * § *A row is a reference, or it is the task*). `j`/`k` walk the results with
 * the preview following, Enter opens the document's page, and ⌘-click,
 * middle-click and the preview's own header link all still take you there —
 * the row stays a real link. The query, the filter and the scroll survive,
 * because the preview lives in a URL parameter and nothing else moves.
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
  /** More results exist beyond the ones rendered. */
  hasMore?: boolean;
  /** The same URL with a larger page size — how "load more" navigates. */
  moreHref?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { query, source, sources, results, error, hasMore, moreHref } = props;
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

  const items = useMemo(
    () => results.filter(r => r.openable).map(r => ({ ref: { type: 'document' as const, id: r.id }, href: `/dashboard/search/${r.id}` })),
    [results],
  );
  const goTo = useCallback((href: string) => router.push(href), [router]);
  const preview = usePreviewList(items, goTo);
  const indexOf = useCallback((id: string) => items.findIndex(i => i.ref.id === id), [items]);

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
                    onSelect={r.openable ? () => preview.select(indexOf(r.id)) : undefined}
                    selected={r.openable && preview.selected >= 0 && preview.selected === indexOf(r.id)}
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
      {hasMore && moreHref && <LoadMore href={moreHref} />}
      <PreviewPanel />
    </>
  );
}

/**
 * "Load more", which also fires on scroll.
 *
 * Paging is a URL parameter rather than client state, because search here is
 * already a server round-trip: the toolbar navigates, and so does this. That
 * keeps one shape for the whole page (design principle 6) and means a longer
 * result set survives a reload, a back button and a shared link.
 *
 * The button is real and focusable rather than a bare sentinel: infinite
 * scroll alone strands anyone on a keyboard, and leaves nothing to press when
 * the observer does not fire. The observer just presses it for you.
 * @param props
 * @param props.href - The same search, one page larger.
 */
function LoadMore({ href }: { href: string }) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading((already) => {
      if (already) {
        return already;
      }
      router.push(href);
      return true;
    });
  }, [href, router]);

  // A new href means the next page arrived: re-arm. Adjusted during render
  // rather than in an effect — the same pattern the search box above uses, and
  // the disabled button never reaches the screen.
  const [seenHref, setSeenHref] = useState(href);
  if (seenHref !== href) {
    setSeenHref(href);
    setLoading(false);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          load();
        }
      },
      // Start fetching before the button is actually on screen, so the list
      // extends while you are still reading rather than after you stop.
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  return (
    <div className="mt-2 flex justify-center">
      <button
        ref={ref}
        type="button"
        onClick={load}
        disabled={loading}
        data-testid="search-load-more"
        className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}
