import { ArrowLeft, ArrowRight, CheckCircle2, OctagonAlert, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getDataset, listRuns } from '@/services/EvalService';
import { RunDatasetButton } from './RunDatasetButton';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export default async function EvalDatasetDetailPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const dataset = await getDataset(orgId, slug);
  if (!dataset) {
    notFound();
  }

  const runs = (await listRuns(orgId, dataset.id)).filter(r => r.datasetId === dataset.id);

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
          agent. Each case is scored by an LLM judge.
        </p>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 font-display text-sm font-semibold">Recent runs</h2>
        {runs.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                No runs yet. Click
                {' '}
                <strong className="font-semibold text-foreground">Run dataset</strong>
                {' '}
                to start one.
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
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-muted-foreground">
                            #
                            {run.id}
                          </span>
                          <RunStatusBadge status={run.status} />
                          <span className="text-sm text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()}
                          </span>
                          {typeof pass === 'number' && (
                            <span className={pass >= 0.8 ? 'font-mono text-xs text-emerald-600 dark:text-emerald-400' : 'font-mono text-xs text-amber-600 dark:text-amber-400'}>
                              {Math.round(pass * 100)}
                              % pass
                            </span>
                          )}
                          {run.workspaceSha && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {run.workspaceSha.slice(0, 7)}
                            </span>
                          )}
                        </div>
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
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
                <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Input</div>
                <div className="text-sm whitespace-pre-wrap">{item.input}</div>
              </div>
              {item.expectedOutput && (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Expected</div>
                  <div className="text-sm whitespace-pre-wrap text-muted-foreground">{item.expectedOutput}</div>
                </div>
              )}
              {item.rubric && (
                <div>
                  <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Rubric</div>
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
