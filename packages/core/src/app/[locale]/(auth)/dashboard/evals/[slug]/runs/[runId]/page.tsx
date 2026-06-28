import { ArrowLeft, CheckCircle2, Loader2, OctagonAlert, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getDataset, getRun } from '@/services/EvalService';

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
            {typeof passRate === 'number' && (
              <span className={passRate >= 0.8 ? 'font-mono text-emerald-600 dark:text-emerald-400' : 'font-mono text-amber-600 dark:text-amber-400'}>
                {Math.round(passRate * 100)}
                % pass
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

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold">Metrics</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Metric label="Pass rate" value={typeof passRate === 'number' ? `${Math.round(passRate * 100)}%` : '—'} />
          <Metric label="Cases" value={String(sortedResults.length)} />
          <Metric label="Failed" value={String(run.metrics?.failed ?? sortedResults.filter(r => r.verdict === 'fail' || r.verdict === 'error').length)} />
          <Metric label="Median latency" value={typeof run.metrics?.medianLatencyMs === 'number' ? `${run.metrics.medianLatencyMs}ms` : '—'} />
        </dl>
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold">Per-case results</h2>
        {sortedResults.length === 0
          ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {run.status === 'running' ? 'Cases still streaming — refresh in a moment.' : 'No case results recorded.'}
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
                        </div>
                        {r.traceId && (
                          <a
                            href={`http://localhost:3200/trace/${r.traceId}`}
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
                          <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Input</div>
                          <div className="whitespace-pre-wrap text-foreground">{r.input}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Output</div>
                          <div className="whitespace-pre-wrap text-foreground">
                            {r.output ?? <span className="text-muted-foreground italic">(no output)</span>}
                          </div>
                        </div>
                        {item?.expectedOutput && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Expected</div>
                            <div className="whitespace-pre-wrap text-muted-foreground">{item.expectedOutput}</div>
                          </div>
                        )}
                        {r.rationale && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Judge rationale</div>
                            <div className="whitespace-pre-wrap text-muted-foreground italic">{r.rationale}</div>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
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
