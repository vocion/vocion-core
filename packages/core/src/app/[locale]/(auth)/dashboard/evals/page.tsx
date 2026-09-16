import { ArrowRight, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listDatasets, listRuns } from '@/services/EvalService';
import { summariseLastRun } from './lastRun';
import { describeProvider } from './providerCopy';

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
        title="Evals"
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
                // Answers "is this measured recently enough to trust?" without
                // opening the dataset — a pass rate with no date cannot.
                const lastRun = summariseLastRun(runs);
                const passRate = lastRun.passRate;
                // Which graders have actually scored this dataset, in the order
                // they last ran. A dataset does not belong to a provider —
                // providers grade runs — so this is what has happened, not a
                // property of the dataset.
                const graders = [...new Set(runs.map(r => r.provider))];
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
                        <span aria-hidden>·</span>
                        <span
                          className={lastRun.warning ? 'text-amber-600 dark:text-amber-400' : undefined}
                          title={lastRun.exactTime ?? undefined}
                        >
                          {lastRun.text}
                        </span>
                        {/*
                          A plain badge with a native tooltip, not the hover
                          card used on the dataset page: the whole card is one
                          link, and a focusable tooltip trigger inside a link
                          is a keyboard trap for the sake of a sentence the
                          dataset page already carries.
                        */}
                        {graders.map(grader => (
                          <Badge key={grader} variant="outline" title={describeProvider(grader).explanation}>
                            {describeProvider(grader).label}
                          </Badge>
                        ))}
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
