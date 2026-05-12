'use client';

import { Search as SearchIcon, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * DocsSearch — ⌘K (or `/`) search box backed by Pagefind.
 *
 * Pagefind is loaded lazily on first open from `/pagefind/pagefind.js`
 * (a static asset emitted by `npm run docs:index` at build time).
 * If the asset is missing (dev mode, build skipped), the search
 * modal renders a "Search index not built" message rather than
 * crashing.
 */

type PagefindResult = {
  id: string;
  data: () => Promise<{
    url: string;
    meta?: { title?: string };
    excerpt: string;
    sub_results?: Array<{ title: string; url: string; excerpt: string }>;
  }>;
};

type PagefindAPI = {
  search: (query: string) => Promise<{ results: PagefindResult[] }>;
};

declare global {
  interface Window {
    pagefind?: PagefindAPI;
  }
}

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ url: string; title: string; excerpt: string }>>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lazy-load Pagefind on first open.
  useEffect(() => {
    if (!open || window.pagefind) {
      return;
    }
    setStatus('loading');
    import(/* webpackIgnore: true */ '/pagefind/pagefind.js' as string)
      .then((p: PagefindAPI) => {
        window.pagefind = p;
        setStatus('idle');
      })
      .catch(() => setStatus('unavailable'));
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open || !query.trim() || !window.pagefind) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const pf = window.pagefind;
      if (!pf) {
        return;
      }
      const r = await pf.search(query);
      const top = await Promise.all(r.results.slice(0, 8).map(x => x.data()));
      if (cancelled) {
        return;
      }
      setResults(top.map(d => ({
        url: d.url,
        title: d.meta?.title ?? d.url,
        excerpt: d.excerpt,
      })));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const trigger = useMemo(() => (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary"
      aria-label="Search docs"
    >
      <SearchIcon className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] sm:inline-block">⌘K</kbd>
    </button>
  ), []);

  return (
    <>
      {trigger}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <SearchIcon className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search the docs…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {status === 'unavailable' && (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  Search index is not built. Run
                  {' '}
                  <code className="rounded bg-muted px-1 py-0.5">npm run docs:index</code>
                  {' '}
                  to generate it.
                </div>
              )}
              {status === 'loading' && (
                <div className="px-4 py-6 text-sm text-muted-foreground">Loading search…</div>
              )}
              {status === 'idle' && !query.trim() && (
                <div className="px-4 py-6 text-xs text-muted-foreground">
                  Type to search. ⌘K to toggle. Esc to close.
                </div>
              )}
              {status === 'idle' && query.trim() && results.length === 0 && (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No matches for "
                  {query}
                  ".
                </div>
              )}
              {results.length > 0 && (
                <ul className="space-y-1">
                  {results.map(r => (
                    <li key={r.url}>
                      <Link
                        href={r.url}
                        onClick={() => setOpen(false)}
                        className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
                      >
                        <div className="font-medium text-foreground">{r.title}</div>
                        <div
                          className="mt-0.5 line-clamp-2 text-xs text-muted-foreground"
                          dangerouslySetInnerHTML={{ __html: r.excerpt }}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
