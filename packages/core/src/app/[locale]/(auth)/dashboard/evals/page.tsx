import { ArrowRight, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listDatasets, listRuns } from '@/services/EvalService';

/**
 * Eval datasets list. Each row links to the dataset detail page where
 * you can review cases + kick off a run.
 * @param props
 * @param props.params
 */
export default async function EvalsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const datasets = await listDatasets(orgId);
  const recentRuns = await listRuns(orgId);
  const runsByDataset = new Map<number, typeof recentRuns>();
  for (const r of recentRuns) {
    const arr = runsByDataset.get(r.datasetId) ?? [];
    arr.push(r);
    runsByDataset.set(r.datasetId, arr);
  }

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TestTube className="size-5" />
            </div>
            <span>Evals</span>
          </div>
        )}
        description="Scored datasets per agent. Run, judge, compare across prompt versions. Each dataset's cases live in YAML at workspace/<org>/evals/<slug>.yaml; runs + per-case results persist in eval_run + eval_case_result."
      />

      {datasets.length === 0
        ? (
            <EmptyState
              title="No eval datasets yet"
              description="Author one at workspace/<org>/evals/<slug>.yaml and run `npm run workspace:apply` to register it."
              icon={TestTube}
            />
          )
        : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {datasets.map((d) => {
                const runs = runsByDataset.get(d.id) ?? [];
                const lastRun = runs[0];
                const passRate = lastRun?.metrics?.passRate;
                return (
                  <li key={d.id}>
                    <Link
                      href={`/dashboard/evals/${d.slug}`}
                      className="block rounded-xl border border-border bg-background p-5 transition hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold">{d.name}</h3>
                          <code className="font-mono text-xs text-muted-foreground">{d.slug}</code>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      {d.description && (
                        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          agent:
                          {d.agentSlug}
                        </Badge>
                        <span aria-hidden>·</span>
                        <span className="font-mono">
                          {d.items.length}
                          {' '}
                          case
                          {d.items.length === 1 ? '' : 's'}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="font-mono">
                          {runs.length}
                          {' '}
                          run
                          {runs.length === 1 ? '' : 's'}
                        </span>
                        {typeof passRate === 'number' && (
                          <>
                            <span aria-hidden>·</span>
                            <span className={passRate >= 0.8 ? 'font-mono text-emerald-600 dark:text-emerald-400' : 'font-mono text-amber-600 dark:text-amber-400'}>
                              {Math.round(passRate * 100)}
                              % pass
                            </span>
                          </>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
    </>
  );
}
