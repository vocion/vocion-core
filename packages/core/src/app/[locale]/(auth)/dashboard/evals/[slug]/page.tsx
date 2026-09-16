import { ArrowLeft, ArrowRight, CheckCircle2, OctagonAlert, TestTube } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { describeProviders } from '@/services/evals/providers/registry';
import { getDataset, listEvaluatorProblems, listRuns } from '@/services/EvalService';
import { ProviderChip } from '../ProviderChip';
import { describeProvider } from '../providerCopy';
import { EvalTrendChart } from './EvalTrendChart';
import { RunDatasetButton } from './RunDatasetButton';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ provider?: string }>;
};

export default async function EvalDatasetDetailPage(props: Props) {
  const { locale, slug } = await props.params;
  const { provider: providerFilter } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const dataset = await getDataset(orgId, slug);
  if (!dataset) {
    notFound();
  }

  const [allRuns, providers, evaluatorProblems] = await Promise.all([
    listRuns(orgId, dataset.id),
    describeProviders(orgId),
    listEvaluatorProblems(orgId, dataset.slug),
  ]);

  // Which graders this dataset has ever had, plus the ones it could use now.
  // A provider nobody has ever run and cannot run stays invisible — an org
  // with no AWS account should see no mention of AgentCore at all.
  const providersWithRuns = new Set(allRuns.map(run => run.provider));
  const shownProviders = providers.filter(p => p.available || providersWithRuns.has(p.id));
  const brokenProviders = providers.filter(p => !p.available && providersWithRuns.has(p.id));
  const labelFor = (id: string) => providers.find(p => p.id === id)?.label ?? id;

  const activeFilter = providerFilter && shownProviders.some(p => p.id === providerFilter) ? providerFilter : null;
  const runs = activeFilter ? allRuns.filter(run => run.provider === activeFilter) : allRuns;

  // Only finished runs carry a pass rate; a running or failed one has nothing
  // to plot and must not be drawn as a zero.
  const trendPoints = runs
    .filter(run => run.status === 'succeeded' && typeof run.metrics?.passRate === 'number')
    .map(run => ({
      runId: run.id,
      provider: run.provider,
      startedAt: new Date(run.startedAt).toISOString(),
      passRate: run.metrics!.passRate as number,
      datasetVersion: run.datasetVersion ?? null,
    }));
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
          {shownProviders.filter(p => p.available).map(p => p.label).join(', ') || 'no available grader'}
          .
        </p>
      </div>

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

      {brokenProviders.map(provider => (
        <div
          key={provider.id}
          className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200"
        >
          <strong className="font-semibold">{provider.label}</strong>
          {' '}
          has scored this dataset before but cannot right now:
          {' '}
          {provider.reason}
          {' '}
          Its past scores are still shown; new runs will be graded without it.
        </div>
      ))}

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

      {trendPoints.length > 1 && (
        <section className="mb-8 rounded-xl border border-border bg-background p-4">
          <h2 className="mb-1 font-display text-sm font-semibold">Pass rate over time</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            One line per grader. A dashed line marks a version of the dataset ending — scores either side of it
            are measuring different cases, so the step is the test changing, not the agent.
          </p>
          <EvalTrendChart
            points={trendPoints}
            providers={shownProviders.map(p => ({ id: p.id, label: p.label }))}
          />
        </section>
      )}

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-sm font-semibold">Recent runs</h2>
          {/*
            Named even when there is only one grader: "who scored this" is the
            fact that makes every number below it mean something, and the
            tooltip says where the judging happened and who is billed.
          */}
          {shownProviders.map(provider => (
            <ProviderChip key={`legend-${provider.id}`} providerId={provider.id} />
          ))}
          {shownProviders.length > 1 && (
            <div className="flex items-center gap-1">
              <ProviderFilterLink slug={dataset.slug} label="All" provider={null} active={activeFilter === null} />
              {shownProviders.map(provider => (
                <ProviderFilterLink
                  key={provider.id}
                  slug={dataset.slug}
                  label={provider.label}
                  provider={provider.id}
                  active={activeFilter === provider.id}
                />
              ))}
            </div>
          )}
        </div>
        {runs.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {activeFilter
                  ? `No runs graded by ${labelFor(activeFilter)} yet.`
                  : 'No runs yet. Press Run evals now to start one.'}
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
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            #
                            {run.id}
                          </span>
                          <RunStatusBadge status={run.status} />
                          {shownProviders.length > 1 && (
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              title={describeProvider(run.provider).explanation}
                            >
                              {labelFor(run.provider)}
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()}
                          </span>
                          {typeof pass === 'number' && (
                            <span className={pass >= 0.8 ? 'font-mono text-xs text-emerald-600 dark:text-emerald-400' : 'font-mono text-xs text-amber-600 dark:text-amber-400'}>
                              {Math.round(pass * 100)}
                              % pass
                            </span>
                          )}
                          {run.model && (
                            <Badge variant="outline" className="font-mono text-[10px]">{run.model}</Badge>
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
 * One pill in the provider filter.
 *
 * A link rather than a control, so the choice is in the URL and can be
 * bookmarked or shared — "AgentCore says we regressed" is a thing people send
 * each other.
 * @param props - Props.
 * @param props.slug - Which dataset the filter belongs to.
 * @param props.label - What the pill says.
 * @param props.provider - The provider id, or null for no filter.
 * @param props.active - Whether this pill is the current choice.
 */
function ProviderFilterLink(props: { slug: string; label: string; provider: string | null; active: boolean }) {
  const href = props.provider
    ? `/dashboard/evals/${props.slug}?provider=${props.provider}`
    : `/dashboard/evals/${props.slug}`;
  return (
    <Link
      href={href}
      aria-current={props.active ? 'page' : undefined}
      className={props.active
        ? 'rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary'
        : 'rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60'}
    >
      {props.label}
    </Link>
  );
}
