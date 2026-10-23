import type { Metadata } from 'next';
import { Search, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListPage, ListRow, Subline } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { describeProvider } from '@/features/evals/providerCopy';
import { clerkAuth as auth } from '@/libs/Auth';
import { formatPassRate } from '@/libs/evals/formatPassRate';
import { Link } from '@/libs/I18nNavigation';
import { askInChatHref } from '@/libs/links';
import { passThresholdFor } from '@/services/evals/runOutcome';
import { EVAL_DATASETS_PAGE_SIZE, listDatasetsPage, summariseDatasetRuns } from '@/services/EvalService';
import { summariseLastRun } from './lastRun';

export const metadata: Metadata = { title: 'Evals' };

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
};

/**
 * Eval datasets, searchable and paged.
 *
 * Each card answers the question someone has before they click: has this been
 * measured lately, by whom, and how did it do. Every number carries its label,
 * because "1 · 4 · 90%" is three facts nobody can read.
 * @param props - Route props.
 * @param props.params - The locale segment.
 * @param props.searchParams - `q` for the search box, `page` for the pager.
 */
export default async function EvalsPage(props: Props) {
  const { locale } = await props.params;
  const { q, page: pageParam } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const search = q?.trim() ?? '';
  const requestedPage = Number.parseInt(pageParam ?? '1', 10);
  const { datasets, page, hasMore } = await listDatasetsPage(orgId, {
    q: search,
    page: Number.isNaN(requestedPage) ? 1 : requestedPage,
  });
  // One query for the whole page of datasets, rather than reading runs and
  // grouping them here — the run counts on these cards have to be the real
  // ones, not however many of the newest fifty happened to belong to each.
  const runFacts = await summariseDatasetRuns(orgId, datasets.map(dataset => dataset.id));
  const searching = search.length > 0;

  return (
    <ListPage
      title="Evals"
      description="Checks that an agent still does its job, run on demand or on a schedule, with every run kept."
    >
      <form action="/dashboard/evals" className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search name, slug or agent"
            aria-label="Search eval datasets"
            className="h-9 w-full rounded-md border border-border bg-background pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-72"
          />
        </div>
        <button type="submit" className="h-9 shrink-0 rounded-md border border-border px-3 text-sm hover:bg-muted/60">
          Search
        </button>
        {searching && (
          <Link href="/dashboard/evals" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {datasets.length === 0
        ? (
            searching
              ? (
                  <EmptyState
                    title={`Nothing matches "${search}"`}
                    description="Search covers the dataset name, its slug and the agent it runs."
                    icon={Search}
                  />
                )
              : (
                  <EmptyState
                    title="No evals yet"
                    description="An eval is a set of example cases an agent should get right, scored every time it runs."
                    action={{ label: 'Ask which checks matter', href: askInChatHref('Which evals should we set up first, and what cases should each one check?') }}
                    authoring={(
                      <>
                        An eval dataset is
                        {' '}
                        <code>evals/&lt;slug&gt;.yaml</code>
                        {' '}
                        in the workspace, registered by
                        {' '}
                        <code>npm run workspace:apply</code>
                        .
                      </>
                    )}
                    icon={TestTube}
                  />
                )
          )
        : (
            <>
              <ul aria-label="Eval datasets" data-pattern="list-rows" className="divide-y divide-border/70">
                {datasets.map((dataset) => {
                  const facts = runFacts.get(dataset.id);
                  // Answers "is this measured recently enough to trust?"
                  // without opening the dataset — a pass rate with no date
                  // cannot.
                  const lastRun = summariseLastRun(facts);
                  const passRate = lastRun.passRate;
                  // The dataset's own grader, not whatever has scored it in
                  // the past: one dataset, one grader, said the same way here
                  // as on the dataset page.
                  const grader = dataset.provider;
                  return (
                    <li key={dataset.id}>
                      <ListRow
                        href={`/dashboard/evals/${dataset.slug}`}
                        title={dataset.name}
                        subline={(
                          <>
                            <Subline
                              separator="·"
                              segments={[<code key="slug" className="font-mono text-xs">{dataset.slug}</code>, dataset.description]}
                            />
                            {/*
                              Labelled facts, wrapping to two lines rather than
                              clipping: a number without its label is not a fact.
                              A plain badge with a native tooltip for the grader,
                              not the hover card the dataset page uses: the whole
                              row is one link, and a focusable tooltip trigger
                              inside a link is a keyboard trap for the sake of a
                              sentence that page already carries.
                            */}
                            <Subline
                              separator="·"
                              className="sm:line-clamp-2"
                              segments={[
                                <Fact key="agent" label="Agent" value={dataset.agentSlug} mono />,
                                <Fact key="cases" label="Cases" value={String(dataset.items.length)} mono />,
                                <Fact key="runs" label="Runs" value={String(facts?.runCount ?? 0)} mono />,
                                <Fact
                                  key="pass"
                                  label="Pass rate"
                                  value={typeof passRate === 'number' ? formatPassRate(passRate) : 'not scored yet'}
                                  mono={typeof passRate === 'number'}
                                  tone={typeof passRate === 'number' && passRate < passThresholdFor(dataset.passThreshold) ? 'warn' : undefined}
                                />,
                                <Fact
                                  key="last"
                                  label="Last run"
                                  value={lastRun.text}
                                  title={lastRun.exactTime ?? undefined}
                                  tone={lastRun.warning ? 'warn' : undefined}
                                />,
                                <span key="grader">
                                  <span className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">Graded by</span>
                                  {' '}
                                  <Badge variant="outline" title={describeProvider(grader).explanation}>
                                    {describeProvider(grader).label}
                                  </Badge>
                                </span>,
                              ]}
                            />
                          </>
                        )}
                      />
                    </li>
                  );
                })}
              </ul>
              {(page > 1 || hasMore) && (
                <DatasetsPager search={search} page={page} shown={datasets.length} hasMore={hasMore} />
              )}
            </>
          )}
    </ListPage>
  );
}

/**
 * One labelled number on a card.
 *
 * Labelled because the row used to read "1 case · 4 runs · 90% pass · 2 days
 * ago", which is four facts a reader has to decode from their units. The label
 * costs a line and removes the decoding.
 * @param props - Props.
 * @param props.label - What the number is.
 * @param props.value - The number, already formatted.
 * @param props.mono - Whether to set the value in the mono face.
 * @param props.tone - `warn` for something the reader should notice.
 * @param props.title - Hover text, e.g. the exact timestamp behind "2 days ago".
 */
function Fact(props: { label: string; value: string; mono?: boolean; tone?: 'warn'; title?: string }) {
  return (
    <span title={props.title}>
      <span className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">{props.label}</span>
      {' '}
      <span className={[props.mono ? 'font-mono' : '', props.tone === 'warn' ? 'text-warn' : 'text-foreground'].filter(Boolean).join(' ')}>
        {props.value}
      </span>
    </span>
  );
}

/**
 * Older and newer pages of datasets, keeping the search in the URL.
 * @param props - Props.
 * @param props.search - The current search text, or empty.
 * @param props.page - The page being shown, 1-based.
 * @param props.shown - How many datasets this page holds.
 * @param props.hasMore - Whether there is another page after this one.
 */
function DatasetsPager(props: { search: string; page: number; shown: number; hasMore: boolean }) {
  const first = (props.page - 1) * EVAL_DATASETS_PAGE_SIZE + 1;
  const linkClass = 'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60';
  return (
    <nav className="mt-4 flex items-center justify-between text-xs text-muted-foreground" aria-label="Dataset list pages">
      {props.page > 1
        ? <Link href={datasetsPageHref(props.search, props.page - 1)} className={linkClass}>Previous</Link>
        : <span />}
      <span className="tabular-nums">{`Datasets ${first}–${first + props.shown - 1}`}</span>
      {props.hasMore
        ? <Link href={datasetsPageHref(props.search, props.page + 1)} className={linkClass}>Next</Link>
        : <span />}
    </nav>
  );
}

/**
 * A list URL that keeps the search and drops a page number of 1.
 * @param search - The current search text, or empty.
 * @param page - The page to link to.
 */
function datasetsPageHref(search: string, page: number): string {
  const params = new URLSearchParams();
  if (search) {
    params.set('q', search);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const query = params.toString();
  return query ? `/dashboard/evals?${query}` : '/dashboard/evals';
}
