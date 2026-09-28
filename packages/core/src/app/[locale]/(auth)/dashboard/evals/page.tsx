import type { Metadata } from 'next';
import { ArrowRight, Search, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { describeProvider } from '@/features/evals/providerCopy';
import { clerkAuth as auth } from '@/libs/Auth';
import { formatPassRate } from '@/libs/evals/formatPassRate';
import { Link } from '@/libs/I18nNavigation';
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
    <>
      <TitleBar
        title="Evals"
        description="Whether an agent still does its job: cases run on demand or on a schedule, scored by graders, with every run kept as history. Authored in workspace/evals."
      />

      <form action="/dashboard/evals" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search name, slug or agent"
            aria-label="Search eval datasets"
            className="h-9 w-72 max-w-full rounded-md border border-border bg-background pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </div>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted/60">
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
                    description="Search covers the dataset name, its slug and the agent it runs. Clear the search to see them all."
                    icon={Search}
                  />
                )
              : (
                  <EmptyState
                    title="No eval datasets yet"
                    description="Author one at workspace/<org>/evals/<slug>.yaml and run `npm run workspace:apply` to register it."
                    icon={TestTube}
                  />
                )
          )
        : (
            <>
              <ul aria-label="Eval datasets" className="grid gap-3 sm:grid-cols-2">
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
                      <Link
                        href={`/dashboard/evals/${dataset.slug}`}
                        className="block rounded-xl border border-border bg-background p-5 transition hover:border-primary/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-semibold">{dataset.name}</h3>
                            <code className="font-mono text-xs text-muted-foreground">{dataset.slug}</code>
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        </div>
                        {dataset.description && (
                          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{dataset.description}</p>
                        )}
                        <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                          <Fact label="Agent" value={dataset.agentSlug} mono />
                          <Fact label="Cases" value={String(dataset.items.length)} mono />
                          <Fact label="Runs" value={String(facts?.runCount ?? 0)} mono />
                          <Fact
                            label="Pass rate"
                            value={typeof passRate === 'number' ? formatPassRate(passRate) : 'not scored yet'}
                            mono={typeof passRate === 'number'}
                            tone={typeof passRate === 'number' && passRate < passThresholdFor(dataset.passThreshold) ? 'warn' : undefined}
                          />
                          <Fact
                            label="Last run"
                            value={lastRun.text}
                            title={lastRun.exactTime ?? undefined}
                            tone={lastRun.warning ? 'warn' : undefined}
                          />
                          <div>
                            <dt className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">Graded by</dt>
                            {/*
                              A plain badge with a native tooltip, not the hover
                              card the dataset page uses: the whole card is one
                              link, and a focusable tooltip trigger inside a link
                              is a keyboard trap for the sake of a sentence that
                              page already carries.
                            */}
                            <dd className="mt-0.5">
                              <Badge variant="outline" title={describeProvider(grader).explanation}>
                                {describeProvider(grader).label}
                              </Badge>
                            </dd>
                          </div>
                        </dl>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {(page > 1 || hasMore) && (
                <DatasetsPager search={search} page={page} shown={datasets.length} hasMore={hasMore} />
              )}
            </>
          )}
    </>
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
    <div title={props.title}>
      <dt className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">{props.label}</dt>
      <dd
        className={[
          'mt-0.5',
          props.mono ? 'font-mono' : '',
          props.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
        ].filter(Boolean).join(' ')}
      >
        {props.value}
      </dd>
    </div>
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
