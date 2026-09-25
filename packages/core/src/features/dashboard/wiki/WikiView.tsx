'use client';

import type { WikiReadingPage } from '@/libs/wiki/reading';
import { BookOpen, ChevronLeft, ChevronRight, History, Pencil, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@/libs/I18nNavigation';
import { filterWikiPages, orderWikiPages, rewriteWikiLink, wikiHome, wikiNeighbours, wikiSections } from '@/libs/wiki/reading';
import { cn } from '@/utils/Helpers';

/**
 * THE WIKI, READ AS A WIKI.
 *
 * Until 2026-09-24 the wiki was a `list` page over the `wiki` artifact folder:
 * a table with stats on top, every row opening the generic artifact viewer.
 * Chris: "make it look more like a wiki than a collection of artifacts
 * table." A wiki is pages in a reading order with a home, one page open
 * beside the list of the others, links between pages that open pages, and
 * on each page who last wrote it and how to change it. That is this.
 *
 * One shape for any folder of markdown pages (the `wiki` page archetype);
 * the rail, the page and the home are the same three pieces on a phone,
 * where the rail folds into a "Pages" disclosure above the article.
 */

type Props = {
  /** The page route, e.g. `/dashboard/p/wiki`; page links are `${base}/${slug}`. */
  base: string;
  /** Every page; only `current` carries its body. */
  pages: WikiReadingPage[];
  /** The open page, or null for the home. */
  current: WikiReadingPage | null;
  /** The plugin's "how the wiki works" page, when it ships one. */
  guideHref?: string | null;
  /** The agent that answers from the wiki (the wiki researcher), for "Ask about this page". */
  askAgentSlug?: string | null;
  /** Where a page is edited and its versions restored — the artifact route. */
  /** Where a page is edited — the artifact route; the page id is appended. A string, because this crosses the server → client boundary. */
  editBase: string;
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function authorLabel(kind: string): string {
  return kind === 'agent' ? 'an agent' : kind === 'human' ? 'a person' : kind === 'system' ? 'the workspace' : kind;
}

export function WikiView({ base, pages, current, guideHref, editBase }: Props) {
  const editHref = (page: WikiReadingPage) => `${editBase}/${page.id}`;
  const [query, setQuery] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const ordered = useMemo(() => orderWikiPages(pages), [pages]);
  const shown = useMemo(() => filterWikiPages(ordered, query), [ordered, query]);
  const home = wikiHome(pages);
  const isHome = current === null || (home !== null && current.slug === home.slug);
  const neighbours = current ? wikiNeighbours(ordered, current.slug) : { prev: null, next: null };

  const rail = (
    <nav aria-label="Wiki pages" className="text-[13.5px]">
      <label className="relative mb-2 block">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a page"
          aria-label="Find a page"
          className="w-full rounded-md border border-rule bg-background py-1.5 pr-2 pl-8 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <ol className="space-y-px">
        {shown.map((p) => {
          const on = current ? p.slug === current.slug : home !== null && p.slug === home.slug;
          const isHomeRow = home !== null && p.slug === home.slug;
          return (
            <li key={p.slug}>
              <Link
                href={isHomeRow ? base : `${base}/${p.slug}`}
                aria-current={on ? 'page' : undefined}
                onClick={() => setRailOpen(false)}
                className={cn(
                  'flex items-baseline gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted',
                  on ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.order !== null && <span className="w-6 shrink-0 font-mono text-[10.5px] text-muted-foreground/70 tabular-nums">{String(p.order).padStart(2, '0')}</span>}
                <span className="min-w-0 truncate">{isHomeRow ? 'Home' : p.title}</span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">No page matches.</li>}
      </ol>
      {guideHref && (
        <Link href={guideHref} className="mt-4 flex items-center gap-1.5 px-2 text-[12.5px] text-muted-foreground hover:text-foreground">
          <BookOpen className="size-3.5" aria-hidden />
          How the wiki works
        </Link>
      )}
    </nav>
  );

  const md = (body: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...rest }) => {
          const to = href ? rewriteWikiLink(href, pages, base) : href;
          const internal = to !== undefined && to.startsWith('/');
          return internal
            ? <Link href={to!} {...rest}>{children}</Link>
            : <a href={to} target="_blank" rel="noreferrer" {...rest}>{children}</a>;
        },
      }}
    >
      {body}
    </ReactMarkdown>
  );

  const article = current && !isHome
    ? (
        <article className="min-w-0">
          <header className="border-b border-rule pb-4">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance">{current.title}</h1>
            {current.summary && <p className="mt-2 max-w-[68ch] text-[15.5px] text-muted-foreground">{current.summary}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted-foreground">
              <span>
                Updated
                {' '}
                {formatDate(current.updatedAt)}
                {' · v'}
                {current.version}
                {' · by '}
                {authorLabel(current.lastAuthorKind)}
              </span>
              {current.tags.map(t => <span key={t} className="rounded-full border border-rule px-2 py-px font-mono text-[10.5px]">{t}</span>)}
              <span className="ml-auto flex items-center gap-3">
                <Link href={editHref(current)} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </Link>
                <Link href={`${editHref(current)}#history`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <History className="size-3.5" aria-hidden />
                  History
                </Link>
              </span>
            </div>
          </header>
          <div className="prose prose-sm mt-6 max-w-[72ch] dark:prose-invert prose-headings:tracking-tight prose-a:text-primary prose-pre:text-[12px]">
            {md(current.md)}
          </div>
          <footer className="mt-10 flex items-center justify-between gap-4 border-t border-rule pt-4 text-[13px]">
            {neighbours.prev
              ? (
                  <Link href={home && neighbours.prev.slug === home.slug ? base : `${base}/${neighbours.prev.slug}`} className="inline-flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground">
                    <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{home && neighbours.prev.slug === home.slug ? 'Home' : neighbours.prev.title}</span>
                  </Link>
                )
              : <span />}
            {neighbours.next
              ? (
                  <Link href={`${base}/${neighbours.next.slug}`} className="inline-flex min-w-0 items-center gap-1 text-right text-muted-foreground hover:text-foreground">
                    <span className="truncate">{neighbours.next.title}</span>
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                  </Link>
                )
              : <span />}
          </footer>
        </article>
      )
    : (
        <article className="min-w-0">
          {home && home.md && (
            <div className="prose prose-sm max-w-[72ch] dark:prose-invert prose-headings:tracking-tight prose-a:text-primary">
              {md(home.md)}
            </div>
          )}
          {pages.length === 0
            ? (
                <p className="max-w-[60ch] text-[15px] text-muted-foreground">
                  Nothing here yet. Say a standing fact in chat — a rule, a voice note, a decision — and the agent writes the first page.
                </p>
              )
            : (
                <div className={cn(home && home.md ? 'mt-10 border-t border-rule pt-6' : '')}>
                  {wikiSections(ordered).map(section => (
                    <section key={section.tag ?? '(untagged)'} className="mb-8">
                      {section.tag && <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">{section.tag}</h2>}
                      <ul className="divide-y divide-rule">
                        {section.pages.map(p => (
                          <li key={p.slug} className="py-3">
                            <Link href={`${base}/${p.slug}`} className="group block">
                              <div className="flex items-baseline gap-2">
                                {p.order !== null && <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">{String(p.order).padStart(2, '0')}</span>}
                                <span className="text-[15px] font-medium group-hover:underline">{p.title}</span>
                                <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{formatDate(p.updatedAt)}</span>
                              </div>
                              {p.summary && <p className="mt-0.5 max-w-[68ch] text-[13.5px] text-muted-foreground">{p.summary}</p>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
          {pages.length > 0 && (
            <div className="mt-2 flex items-center gap-3 text-[12.5px] text-muted-foreground">
            </div>
          )}
        </article>
      );

  return (
    <div data-pattern="wiki" className="@container">
      {/* Phone: the rail folds into a disclosure above the article. */}
      <div className="mb-4 @3xl:hidden">
        <button
          type="button"
          onClick={() => setRailOpen(o => !o)}
          aria-expanded={railOpen}
          className="inline-flex items-center gap-2 rounded-md border border-rule bg-background px-3 py-1.5 text-[13px]"
        >
          <BookOpen className="size-3.5" aria-hidden />
          Pages
          <span className="text-muted-foreground">
            {' '}
            {pages.length}
          </span>
        </button>
        {railOpen && <div className="mt-3 rounded-md border border-rule bg-background p-3">{rail}</div>}
      </div>
      <div className="grid gap-10 @3xl:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden @3xl:block">
          <div className="sticky top-4">{rail}</div>
        </div>
        {article}
      </div>
      <p className="sr-only" aria-live="polite">{current ? `Reading ${current.title}` : 'Wiki home'}</p>
    </div>
  );
}
