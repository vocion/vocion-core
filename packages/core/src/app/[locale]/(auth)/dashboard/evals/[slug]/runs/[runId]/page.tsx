import { ArrowLeft, CheckCircle2, Loader2, OctagonAlert, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { describeProvider } from '@/features/evals/providerCopy';
import { clerkAuth as auth } from '@/libs/Auth';
import { formatPassRate } from '@/libs/evals/formatPassRate';
import { Link } from '@/libs/I18nNavigation';
import { langfuseConfig } from '@/libs/Langfuse';
import { browserProjectId } from '@/libs/Langfuse/config';
import { usd } from '@/services/evals/modelUpgradeTest';
import { describeProviders } from '@/services/evals/providers/registry';
import { passThresholdFor } from '@/services/evals/runOutcome';
import { getDataset, getRun, listRunGroup, listScoresForRun } from '@/services/EvalService';
import { RunAutoRefresh } from './RunAutoRefresh';

type Props = {
  params: Promise<{ locale: string; slug: string; runId: string }>;
};

export default async function EvalRunDetailPage(props: Props) {
  const { locale, slug, runId } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const runIdNum = Number.parseInt(runId, 10);
  if (!Number.isFinite(runIdNum)) {
    notFound();
  }

  const [dataset, run] = await Promise.all([
    getDataset(orgId, slug),
    getRun(orgId, runIdNum),
  ]);
  if (!dataset || !run) {
    notFound();
  }
  if (run.datasetId !== dataset.id) {
    // Slug + runId mismatch — guard the cross-dataset URL juggling.
    notFound();
  }

  const passRate = run.metrics?.passRate;
  const sortedResults = [...run.results].sort((a, b) => a.itemIndex - b.itemIndex);

  const [scores, providers, siblingRuns] = await Promise.all([
    listScoresForRun(run.id),
    describeProviders(orgId),
    run.runGroupId ? listRunGroup(orgId, run.runGroupId, run.id) : Promise.resolve([]),
  ]);
  const labelFor = (id: string) => providers.find(p => p.id === id)?.label ?? id;

  // The trace link opens in the reader's browser, so it needs the externally
  // reachable Langfuse URL rather than the internal hostname the app posts to.
  // Null when tracing is off — there is nothing to link to, and a link to
  // localhost from a deployed app is a dead end dressed up as a feature.
  const langfuse = langfuseConfig();
  const traceBaseUrl = langfuse.enabled
    ? `${langfuse.browserBaseUrl}/project/${browserProjectId(langfuse)}/traces`
    : null;

  // A score with no case belongs to the run as a whole — AgentCore's
  // session-level evaluators grade the conversation, not any one turn.
  const scoresByCase = new Map<number, typeof scores>();
  const runLevelScores: typeof scores = [];
  for (const score of scores) {
    if (score.caseResultId === null) {
      runLevelScores.push(score);
      continue;
    }
    const existing = scoresByCase.get(score.caseResultId);
    if (existing) {
      existing.push(score);
    } else {
      scoresByCase.set(score.caseResultId, [score]);
    }
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href={`/dashboard/evals/${slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to
          {' '}
          {dataset.name}
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TestTube className="size-5" />
            </div>
            <div>
              <span>{dataset.name}</span>
              <span className="ml-3 font-mono text-sm text-muted-foreground">
                run #
                {run.id}
              </span>
            </div>
          </div>
        )}
        description={(
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <RunStatusBadge status={run.status} />
            {/* The grader, with the same explanation the list and cards carry. */}
            <Badge variant="outline" className="text-[10px]" title={describeProvider(run.provider).explanation}>
              graded by
              {' '}
              {labelFor(run.provider)}
            </Badge>
            {typeof passRate === 'number' && (
              <span className={passRate >= passThresholdFor(dataset.passThreshold) ? 'font-mono text-emerald-600 dark:text-emerald-400' : 'font-mono text-amber-600 dark:text-amber-400'}>
                {`${formatPassRate(passRate)} pass`}
              </span>
            )}
            <span>
              started
              {' '}
              {new Date(run.startedAt).toLocaleString()}
            </span>
            {run.completedAt && (
              <>
                <span aria-hidden>·</span>
                <span>
                  completed
                  {' '}
                  {new Date(run.completedAt).toLocaleString()}
                </span>
              </>
            )}
            {run.model && (
              <span className="font-mono text-xs">
                model
                {' '}
                {run.model}
              </span>
            )}
            {run.workspaceSha && (
              <span className="font-mono text-xs">
                context
                {' '}
                {run.workspaceSha.slice(0, 7)}
              </span>
            )}
          </div>
        )}
      />

      <RunAutoRefresh running={run.status === 'running'} />

      {run.status === 'failed' && run.errorMessage && (
        // A grader that refused the whole run says why here. Cases that failed
        // on their merits are not this: those have scores, and read below.
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
          <div className="mb-1 font-semibold">
            {labelFor(run.provider)}
            {' '}
            could not grade this run
          </div>
          <p>{run.errorMessage}</p>
          <p className="mt-1">
            The transcripts were produced and are listed below; only the scoring failed. Earlier runs keep their scores.
          </p>
        </div>
      )}

      {siblingRuns.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
          <span>The same cases were also graded by</span>
          {siblingRuns.map(sibling => (
            <Link
              key={sibling.id}
              href={`/dashboard/evals/${slug}/runs/${sibling.id}`}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              {labelFor(sibling.provider)}
              {typeof sibling.metrics?.passRate === 'number' && ` (${formatPassRate(sibling.metrics.passRate)} pass)`}
            </Link>
          ))}
          <span>— same run, different grader.</span>
        </div>
      )}

      {runLevelScores.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 font-display text-sm font-semibold">Whole-run scores</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Evaluators that grade the session rather than any one case.
          </p>
          <ul className="space-y-2">
            {runLevelScores.map(score => (
              <li key={score.id} className="rounded-lg border border-border bg-background px-4 py-3">
                <ScoreChip
                  name={score.evaluatorName ?? score.evaluatorSlug}
                  label={score.label}
                  value={score.value}
                  errorMessage={score.errorMessage}
                />
                {score.explanation && (
                  <p className="mt-2 text-xs text-muted-foreground italic">{score.explanation}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold">Metrics</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Metric label="Pass rate" value={typeof passRate === 'number' ? formatPassRate(passRate) : '—'} />
          <Metric label="Cases" value={String(sortedResults.length)} />
          <Metric label="Failed" value={String(run.metrics?.failed ?? sortedResults.filter(r => r.verdict === 'fail' || r.verdict === 'error').length)} />
          <Metric label="Median latency" value={typeof run.metrics?.medianLatencyMs === 'number' ? `${run.metrics.medianLatencyMs}ms` : '—'} />
          <Metric label="Total cost" value={typeof run.metrics?.totalCents === 'number' ? usd(run.metrics.totalCents) : '—'} />
          <Metric label="Cost per passed case" value={typeof run.metrics?.costPerPassedCaseCents === 'number' ? usd(run.metrics.costPerPassedCaseCents) : '—'} />
          <Metric label="Mean turns per case" value={typeof run.metrics?.meanTurns === 'number' ? run.metrics.meanTurns.toFixed(2) : '—'} />
          <Metric label="Tokens in / out" value={typeof run.metrics?.totalInputTokens === 'number' ? `${run.metrics.totalInputTokens.toLocaleString('en-US')} / ${(run.metrics.totalOutputTokens ?? 0).toLocaleString('en-US')}` : '—'} />
        </dl>
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold">Per-case results</h2>
        {/*
          Announced, because the page really does change on its own: the client
          poll swaps this copy for results as cases land, and a screen-reader
          user who is told "this page updates itself" has to actually hear the
          update.
        */}
        {sortedResults.length === 0
          ? (
              <p aria-live="polite" className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {run.status === 'running'
                  ? 'Still running — this page updates itself as cases finish.'
                  : 'No case results recorded.'}
              </p>
            )
          : (
              <ol className="space-y-3">
                {sortedResults.map((r) => {
                  const item = dataset.items[r.itemIndex];
                  const verdict = r.verdict ?? 'pending';
                  return (
                    <li key={r.id} className="rounded-xl border border-border bg-background">
                      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-muted-foreground">
                            #
                            {r.itemIndex + 1}
                          </span>
                          <VerdictBadge verdict={verdict} />
                          {r.score != null && (
                            <span className="font-mono text-xs text-muted-foreground">
                              score
                              {' '}
                              {r.score}
                            </span>
                          )}
                          {r.latencyMs != null && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {r.latencyMs}
                              ms
                            </span>
                          )}
                          {r.usage && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {usd(r.usage.cents)}
                              {' · '}
                              {r.usage.turns}
                              {' '}
                              turns
                              {' · '}
                              {r.usage.toolCalls}
                              {' '}
                              tools
                            </span>
                          )}
                        </div>
                        {r.traceId && traceBaseUrl && (
                          <a
                            href={`${traceBaseUrl}/${r.traceId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Langfuse trace ↗
                          </a>
                        )}
                      </header>
                      <div className="grid gap-4 px-4 py-4 text-sm md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Input</div>
                          <div className="whitespace-pre-wrap text-foreground">{r.input}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Output</div>
                          <div className="whitespace-pre-wrap text-foreground">
                            {r.output ?? <span className="text-muted-foreground italic">(no output)</span>}
                          </div>
                        </div>
                        {item?.expectedOutput && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Expected</div>
                            <div className="whitespace-pre-wrap text-muted-foreground">{item.expectedOutput}</div>
                          </div>
                        )}
                        {r.rationale && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Judge rationale</div>
                            <div className="whitespace-pre-wrap text-muted-foreground italic">{r.rationale}</div>
                          </div>
                        )}
                        {r.trajectory && r.trajectory.length > 0 && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Tools called</div>
                            <div className="font-mono text-xs text-muted-foreground">{r.trajectory.join(' → ')}</div>
                          </div>
                        )}
                        {(scoresByCase.get(r.id)?.length ?? 0) > 0 && (
                          <div className="md:col-span-2">
                            <div className="mb-2 text-xs font-medium text-muted-foreground">Evaluators</div>
                            <ul className="space-y-2">
                              {scoresByCase.get(r.id)!.map(score => (
                                <li key={score.id}>
                                  <ScoreChip
                                    name={score.evaluatorName ?? score.evaluatorSlug}
                                    label={score.label}
                                    value={score.value}
                                    errorMessage={score.errorMessage}
                                  />
                                  {score.explanation && (
                                    <p className="mt-1 text-xs text-muted-foreground italic">{score.explanation}</p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
      </section>
    </>
  );
}

/**
 * One evaluator's verdict on one thing.
 *
 * An evaluator that errored is shown as errored, not as a fail. "AWS timed
 * out" and "the agent got it wrong" look identical once both are a red badge,
 * and the first one is not a quality signal at all.
 * @param props - Props.
 * @param props.name - The evaluator, as a person would name it.
 * @param props.label - pass, fail, or whatever the provider called it.
 * @param props.value - The numeric score, when there is one.
 * @param props.errorMessage - Set when the evaluator could not answer.
 */
function ScoreChip(props: { name: string; label: string | null; value: number | null; errorMessage: string | null }) {
  const tone = props.errorMessage
    ? 'bg-muted text-muted-foreground'
    : props.label === 'pass'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : props.label === 'fail'
        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
        : 'bg-muted text-muted-foreground';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground">{props.name}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
        {props.errorMessage ? 'could not score' : props.label ?? '—'}
      </span>
      {props.value !== null && !props.errorMessage && (
        <span className="font-mono text-xs text-muted-foreground">{props.value.toFixed(2)}</span>
      )}
      {props.errorMessage && (
        <span className="text-xs text-muted-foreground">{props.errorMessage}</span>
      )}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
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
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
        <Loader2 className="size-3 animate-spin" />
        {' '}
        running
      </span>
    );
  }
  return <Badge variant="secondary">{status}</Badge>;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        pass
      </span>
    );
  }
  if (verdict === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
        fail
      </span>
    );
  }
  if (verdict === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        error
      </span>
    );
  }
  return <Badge variant="secondary">{verdict}</Badge>;
}
