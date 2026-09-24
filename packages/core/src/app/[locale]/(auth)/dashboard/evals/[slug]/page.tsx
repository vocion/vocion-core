import type { DatasetSyncTone } from './datasetSync';
import type { EvalDatasetItem } from '@/services/evals/types';
import type { RunPeriodSummary } from '@/services/EvalService';
import { ArrowLeft, ArrowRight, CheckCircle2, OctagonAlert, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { describeProvider } from '@/features/evals/providerCopy';
import { clerkAuth as auth } from '@/libs/Auth';
import { MAX_TREND_RUNS } from '@/libs/evals/runRange';
import { Link } from '@/libs/I18nNavigation';
import { describeProviders } from '@/services/evals/providers/registry';
import { describeDatasetSync } from '@/services/evals/publish';
import { EVAL_RUNS_PAGE_SIZE, getDataset, listEvaluatorProblems, listEvaluatorTrend, listRuns, listRunsPage, listRunTrend, summariseRunPeriod } from '@/services/EvalService';
import { ProviderChip } from '../ProviderChip';
import { summariseDatasetSync } from './datasetSync';
import { periodQuery, readEvalPeriod, runsPageHref } from './evalPeriod';
import { EvalPeriodPicker } from './EvalPeriodPicker';
import { EvalTrendChart } from './EvalTrendChart';
import { RunDatasetButton } from './RunDatasetButton';

/**
 * How firmly each sync state is drawn.
 *
 * A failed copy is the only one worth colouring like a warning: behind is
 * normal between an edit and the next run, and in step is the state nobody
 * needs to notice.
 */
const SYNC_TONE_CLASSES: Record<DatasetSyncTone, string> = {
  'local': 'border-border bg-muted/20 text-muted-foreground',
  'pending': 'border-border bg-muted/20 text-muted-foreground',
  'behind': 'border-border bg-muted/20 text-foreground',
  'in-step': 'border-border bg-muted/20 text-muted-foreground',
  'failed': 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200',
};

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string; period?: string; from?: string; to?: string }>;
};

export default async function EvalDatasetDetailPage(props: Props) {
  const { locale, slug } = await props.params;
  const { page: pageParam, ...periodParams } = await props.searchParams;
  // One period for the whole page: the chart, the numbers above it and the
  // run list all read this, so none of them can show a different window.
  const period = readEvalPeriod(periodParams);
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const dataset = await getDataset(orgId, slug);
  if (!dataset) {
    notFound();
  }

  const [allRuns, providers, evaluatorProblems, syncState] = await Promise.all([
    listRuns(orgId, dataset.id),
    describeProviders(orgId),
    listEvaluatorProblems(orgId, dataset.slug),
    // The column's declared shape is looser than the one the eval code reads;
    // `EvalService` narrows it the same way for the same reason.
    describeDatasetSync(orgId, dataset.id, dataset.provider, (dataset.items ?? []) as EvalDatasetItem[], dataset.slug),
  ]);

  // One grader per dataset, named in the workspace file. Runs from before a
  // dataset changed graders keep whatever scored them, which is why the run
  // rows still carry a provider of their own.
  const grader = providers.find(p => p.id === dataset.provider);
  const graderLabel = grader?.label ?? dataset.provider;
  const graderProblem = grader && !grader.available ? grader.reason : null;
  const labelFor = (id: string) => providers.find(p => p.id === id)?.label ?? id;
  const historicalProviders = [...new Set(allRuns.map(run => run.provider))].filter(id => id !== dataset.provider);

  // Where the cases themselves live. A grader that holds its own copy of them
  // can be holding older ones than the workspace file does, and a score means
  // something different depending on which it graded.
  const sync = summariseDatasetSync({
    graderLabel,
    keepsDataset: grader?.keepsDataset ?? false,
    workspaceVersion: dataset.version,
    state: syncState,
  });

  // The list is paged; the chart is not. They answer different questions — one
  // is "what happened lately", the other is "which way is this going" — and a
  // trend line that redrew itself as you paged would be lying about the shape.
  const requestedPage = Number.parseInt(pageParam ?? '1', 10);
  const [{ runs, page, hasMore }, trend, summary, evaluatorTrend] = await Promise.all([
    listRunsPage(orgId, dataset.id, { page: Number.isNaN(requestedPage) ? 1 : requestedPage, range: period.range }),
    listRunTrend(orgId, dataset.id, period.range),
    summariseRunPeriod(orgId, dataset.id, dataset.provider, period.range),
    listEvaluatorTrend(orgId, dataset.id, period.range),
  ]);

  // A run still in progress has no pass rate yet, and must not be drawn as a zero.
  const runTrendPoints = trend.runs
    .filter(run => typeof run.metrics?.passRate === 'number')
    .map(run => ({
      runId: run.id,
      provider: run.provider,
      startedAt: new Date(run.startedAt).toISOString(),
      passRate: run.metrics!.passRate as number,
      datasetVersion: run.datasetVersion ?? null,
      evaluatorSlug: null,
    }));

  // One line per evaluator under each grader's own. The pass rate says whether
  // the dataset is passing; these say which part of it moved, which is the
  // question a flat pass rate hides.
  // When the run chart had to stop at its limit, the evaluator lines stop with
  // it, so the two never cover different stretches of time.
  const plottedRunIds = new Set(trend.runs.map(run => run.id));
  const evaluatorTrendPoints = evaluatorTrend.filter(row => !trend.truncated || plottedRunIds.has(row.runId)).map(row => ({
    runId: row.runId,
    provider: row.provider,
    startedAt: new Date(row.startedAt).toISOString(),
    passRate: row.meanValue,
    datasetVersion: row.datasetVersion ?? null,
    evaluatorSlug: row.evaluatorSlug,
  }));
  const trendPoints = [...runTrendPoints, ...evaluatorTrendPoints];
  const filtered = period.period !== 'all';
  const pagerQuery = periodQuery(period).toString();
  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/evals"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Evals
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TestTube className="size-5" />
            </div>
            <div>
              <div>{dataset.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Badge variant="outline">
                  agent:
                  {dataset.agentSlug}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{dataset.slug}</span>
                <Badge variant="outline">
                  v
                  {dataset.version}
                </Badge>
              </div>
            </div>
          </div>
        )}
        description={dataset.description ?? ''}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <RunDatasetButton slug={dataset.slug} />
        <p className="text-xs text-muted-foreground">
          Runs the dataset's
          {' '}
          {dataset.items.length}
          {' '}
          case
          {dataset.items.length === 1 ? '' : 's'}
          {' '}
          against the
          {' '}
          <code className="font-mono">{dataset.agentSlug}</code>
          {' '}
          agent. Scored by
          {' '}
          {graderLabel}
          .
        </p>
      </div>

      <section className={`mb-6 rounded-lg border px-4 py-3 text-xs ${SYNC_TONE_CLASSES[sync.tone]}`}>
        <div className="font-semibold">{sync.headline}</div>
        <p className="mt-1">{sync.detail}</p>
        {sync.remoteId && (
          <p className="mt-2 text-muted-foreground">
            Dataset in
            {' '}
            {graderLabel}
            :
            {' '}
            <code className="font-mono">{sync.remoteId}</code>
            {sync.syncedAt && (
              <>
                {/* The same column records the last attempt whether it landed
                    or not, so a failed copy must not read "last copied" under
                    a headline saying the copy failed. */}
                {sync.tone === 'failed' ? ' · last attempt ' : ' · last copied '}
                {new Date(sync.syncedAt).toLocaleString()}
              </>
            )}
          </p>
        )}
      </section>

      {evaluatorProblems.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
          <div className="mb-1 font-semibold">Some evaluators this dataset declares could not be set up</div>
          <ul className="space-y-1">
            {evaluatorProblems.map(problem => (
              <li key={`${problem.provider}-${problem.slug}`}>
                <code className="font-mono">{problem.slug}</code>
                {' — '}
                {problem.syncError}
              </li>
            ))}
          </ul>
          <p className="mt-2">Runs go ahead without them rather than failing, so scores here are missing those checks.</p>
        </div>
      )}

      {graderProblem && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
          <strong className="font-semibold">{graderLabel}</strong>
          {' '}
          grades this dataset but cannot run right now:
          {' '}
          {graderProblem}
          {' '}
          Past scores are still shown; a new run will refuse to start until this is fixed, rather than
          executing every case and failing at the end.
        </div>
      )}

      {/*
        The model upgrade test is not rendered.

        The feature exists — `CompareModelsForm`, `/api/v1/evals/[slug]/model-upgrade-test`
        and `services/evals/modelUpgradeTest.ts` are all still here, and the
        compare view at `[slug]/compare` still reads two runs — but it runs both
        models inside the one request, so anything past a handful of cases times
        out before it answers. Nobody is using it, and a broken control on this
        page costs more attention than it is worth. Put this block back when the
        run moves onto the same Temporal workflow the refresh uses.
      */}

      {/* A dataset that has never run has no results to pick a period for; the
          run list below already says so, and a row of dashes would only
          repeat it. */}
      {(filtered || summary.runCount > 0) && (
        <section className="mb-8 space-y-4" aria-label="Results for the period">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold">Results</h2>
            <EvalPeriodPicker
              period={period.period}
              from={period.range.from?.toISOString() ?? null}
              to={period.range.to?.toISOString() ?? null}
            />
          </div>

          {period.problem && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-800 dark:text-amber-200" role="alert">
              {period.problem}
            </p>
          )}

          <PeriodSummary summary={summary} graderLabel={graderLabel} />

          {trendPoints.length > 1
            ? (
                <div className="rounded-xl border border-border bg-background p-4">
                  <h3 className="mb-1 font-display text-sm font-semibold">Pass rate over time</h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    A dashed line marks a version of the dataset ending — scores either side of it are measuring
                    different cases, so the step is the test changing, not the agent.
                  </p>
                  {trend.truncated && (
                    <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                      {`Showing the newest ${MAX_TREND_RUNS.toLocaleString('en-US')} runs in this period. Pick a shorter period to see the ones before them.`}
                    </p>
                  )}
                  <EvalTrendChart
                    points={trendPoints}
                    providers={providers.map(p => ({ id: p.id, label: p.label }))}
                  />
                </div>
              )
            : filtered && summary.runCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Too few scored runs in this period to draw a trend. Pick a longer period to see one.
              </p>
            )}
        </section>
      )}

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-sm font-semibold">{filtered ? 'Runs in this period' : 'Recent runs'}</h2>
          {/* The dataset's grader, said once, with the explanation on hover. */}
          <ProviderChip providerId={dataset.provider} />
          {historicalProviders.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {`Older runs here were scored by ${historicalProviders.map(labelFor).join(' and ')}, before this dataset changed graders.`}
            </span>
          )}
        </div>
        {runs.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {filtered ? 'No runs in this period. Pick a longer one, or All time.' : 'No runs yet. Press Run evals now to start one.'}
              </div>
            )
          : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-background">
                {runs.map((run) => {
                  const pass = run.metrics?.passRate;
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/dashboard/evals/${dataset.slug}/runs/${run.id}`}
                        className="flex items-center justify-between px-4 py-3 hover:bg-muted/40"
                      >
                        {/*
                          Labelled, like the cards on the list: a bare "#11 ·
                          90% · a1b2c3d" asks the reader to work out which
                          number is which, and the workspace SHA in particular
                          looks like noise until it is named.
                        */}
                        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <RunFact label="Run">
                            <span className="font-mono">
                              #
                              {run.id}
                            </span>
                          </RunFact>
                          <RunFact label="Status"><RunStatusBadge status={run.status} /></RunFact>
                          {run.provider !== dataset.provider && (
                            <RunFact label="Graded by">
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                                title={describeProvider(run.provider).explanation}
                              >
                                {labelFor(run.provider)}
                              </Badge>
                            </RunFact>
                          )}
                          <RunFact label="Started">{new Date(run.startedAt).toLocaleString()}</RunFact>
                          {typeof pass === 'number' && (
                            <RunFact label="Pass rate">
                              <span className={pass >= 0.8 ? 'font-mono text-emerald-600 dark:text-emerald-400' : 'font-mono text-amber-600 dark:text-amber-400'}>
                                {Math.round(pass * 100)}
                                %
                              </span>
                            </RunFact>
                          )}
                          {run.model && (
                            <RunFact label="Model">
                              <Badge variant="outline" className="font-mono text-[10px]">{run.model}</Badge>
                            </RunFact>
                          )}
                          {run.workspaceSha && (
                            <RunFact label="Workspace">
                              <span className="font-mono" title={run.workspaceSha}>{run.workspaceSha.slice(0, 7)}</span>
                            </RunFact>
                          )}
                        </dl>
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
        {(page > 1 || hasMore) && (
          <RunsPager slug={dataset.slug} page={page} shown={runs.length} hasMore={hasMore} query={pagerQuery} />
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold">
          Cases (
          {dataset.items.length}
          )
        </h2>
        <ol className="space-y-3">
          {dataset.items.map((item, i) => (
            <li key={i} className="rounded-xl border border-border bg-background p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  #
                  {i + 1}
                </span>
                {item.tags?.map(tag => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Input</div>
                <div className="text-sm whitespace-pre-wrap">{item.input}</div>
              </div>
              {item.expectedOutput && (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Expected</div>
                  <div className="text-sm whitespace-pre-wrap text-muted-foreground">{item.expectedOutput}</div>
                </div>
              )}
              {item.rubric && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Rubric</div>
                  <div className="text-sm whitespace-pre-wrap text-muted-foreground italic">{item.rubric}</div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'succeeded') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        {' '}
        succeeded
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
        <OctagonAlert className="size-3" />
        {' '}
        failed
      </span>
    );
  }
  return (
    <Badge variant="secondary">{status}</Badge>
  );
}

/**
 * One labelled thing on a run row.
 * @param props - Props.
 * @param props.label - What the value is.
 * @param props.children - The value itself.
 */
function RunFact(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">{props.label}</dt>
      <dd className="mt-0.5 text-xs text-foreground">{props.children}</dd>
    </div>
  );
}

/**
 * Older and newer, for a run list that outgrew one page.
 *
 * Page number in the URL so a link to "the page where it regressed" still
 * points at the same runs tomorrow.
 * @param props - Props.
 * @param props.slug - Which dataset.
 * @param props.page - The page being shown, 1-based.
 * @param props.shown - How many runs this page actually holds.
 * @param props.hasMore - Whether there is an older page after this one.
 * @param props.query - The period's query string, kept on every page link.
 */
function RunsPager(props: { slug: string; page: number; shown: number; hasMore: boolean; query: string }) {
  const first = (props.page - 1) * EVAL_RUNS_PAGE_SIZE + 1;
  const linkClass = 'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60';
  return (
    <nav className="mt-3 flex items-center justify-between text-xs text-muted-foreground" aria-label="Run list pages">
      {props.page > 1
        ? (
            <Link href={runsPageHref(props.slug, props.page - 1, props.query)} className={linkClass}>
              Newer runs
            </Link>
          )
        : <span />}
      <span className="tabular-nums">
        {`Runs ${first}–${first + props.shown - 1}`}
      </span>
      {props.hasMore
        ? (
            <Link href={runsPageHref(props.slug, props.page + 1, props.query)} className={linkClass}>
              Older runs
            </Link>
          )
        : <span />}
    </nav>
  );
}

/**
 * A pass rate as a whole percentage, or a dash when nothing was scored — never
 * 0%, which would read as "fails everything" about a period nobody measured.
 * @param rate - 0–1, or null.
 */
function formatPassRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * The headline numbers for the period on screen.
 * @param props - Props.
 * @param props.summary - What `summariseRunPeriod` counted.
 * @param props.graderLabel - Who scored the runs the pass rates cover.
 */
function PeriodSummary(props: { summary: RunPeriodSummary; graderLabel: string }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="eval-period-summary">
      <SummaryStat label="Runs" value={props.summary.runCount.toLocaleString('en-US')} detail="Every run that started in this period." />
      <SummaryStat label="Average pass rate" value={formatPassRate(props.summary.averagePassRate)} detail={`Across ${props.summary.scoredCount.toLocaleString('en-US')} finished run${props.summary.scoredCount === 1 ? '' : 's'} scored by ${props.graderLabel}.`} />
      <SummaryStat label="Latest pass rate" value={formatPassRate(props.summary.latestPassRate)} detail="The newest finished run in this period." />
    </dl>
  );
}

/**
 * One number in the period summary.
 * @param props - Props.
 * @param props.label - What it counts.
 * @param props.value - The number, formatted.
 * @param props.detail - What exactly went into it.
 */
function SummaryStat(props: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <dt className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">{props.label}</dt>
      <dd className="mt-1 font-mono text-lg text-foreground">{props.value}</dd>
      <dd className="mt-0.5 text-[11px] text-muted-foreground">{props.detail}</dd>
    </div>
  );
}
