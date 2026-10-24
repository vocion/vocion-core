import { ExternalLink, LineChart } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ExtensionSlot } from '@/features/extensions/ExtensionSlot';
import { RoutingSection } from '@/features/routing/RoutingSection';
import { routingStatusLine } from '@/features/routing/routingStatus';
import { SpendView, spendViewState } from '@/features/spend/SpendView';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { langfuseConfig } from '@/libs/Langfuse';
import { browserProjectId } from '@/libs/Langfuse/config';
import { listAgentBudgets, listPlatformBudgets, ORG_SCOPE_SLUG, orgUsageTotals } from '@/services/BudgetService';
import { countRunsLast24h } from '@/services/ObservabilityService';
import { routingSummary } from '@/services/spend/routing';
import { periodRange, spendBy } from '@/services/spend/spend';
import { effectiveRole } from '@/services/WorkspaceAccessService';
import { ORG_ROLE } from '@/types/Auth';

/**
 * /dashboard/observability — Langfuse-fronted spend + run-volume index.
 *
 * Intentionally light. The Langfuse UI is the exploration surface;
 * this page is a launch pad with three numbers that match the
 * day-to-day questions ("how much have we spent?", "is anything
 * running?", "which agent is hot today?") + saved-filter deep-links
 * into Langfuse.
 */

const FILTER_ENCODE = (params: Record<string, string>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    search.append(k, v);
  }
  return search.toString();
};

export default async function ObservabilityPage(props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId, accountId, has } = await auth();

  // These links open in the operator's browser, so they need the
  // externally reachable Langfuse URL. On a self-hosted box the app
  // posts traces to an internal compose hostname
  // (http://langfuse-web:3000) that no browser can resolve, so reading
  // LANGFUSE_BASE_URL here produced links that always failed. Null when
  // tracing is off — there is nothing to link to.
  const langfuse = langfuseConfig();
  const langfuseUrl = langfuse.enabled
    ? `${langfuse.browserBaseUrl}/project/${browserProjectId(langfuse)}/traces`
    : null;

  if (!orgId) {
    return (
      <>
        <TitleBar
          title="Observability"
          description="Per-org / per-user / per-feature LLM cost + run volume, powered by Langfuse."
        />
        <div className="text-sm text-muted-foreground">
          Sign in to an organization to see spend and run volume for your workspace.
        </div>
      </>
    );
  }

  // Spend from the ledger: an Org admin reads the whole Org or this workspace,
  // a workspace admin this workspace, anyone else nothing.
  const canReadOrg = Boolean(accountId) && has({ role: ORG_ROLE.ADMIN });
  const canReadSpend = canReadOrg || (userId ? await effectiveRole(userId, orgId).catch(() => null) === 'admin' : false);
  const spendState = spendViewState((await props.searchParams) ?? {}, canReadOrg);
  const spendRead = canReadSpend
    ? (() => {
        const { from, to } = periodRange(spendState.period);
        return spendBy({ scope: spendState.scope === 'org' ? { accountId: accountId! } : { orgId }, groupBy: spendState.group, from, to, filters: spendState.filters }).catch(() => null);
      })()
    : Promise.resolve(null);

  // Dynamic routing (ADR 0006): same reader, same scope and period as spend.
  const routingRead = canReadSpend
    ? (async () => {
        const { from, to } = periodRange(spendState.period);
        const { jevKeyStatus } = await import('@/services/routing/jevKey');
        const [summary, keys] = await Promise.all([
          routingSummary({ scope: spendState.scope === 'org' ? { accountId: accountId! } : { orgId }, from, to }),
          jevKeyStatus(orgId).catch(() => null),
        ]);
        const hint = keys?.effective === 'workspace' ? keys.workspace?.hint ?? null : keys?.instance?.hint ?? null;
        return { summary, status: routingStatusLine(keys ? { effective: keys.effective, hint } : null) };
      })().catch(() => null)
    : Promise.resolve(null);

  const [budgets, platformBudgets, orgTotals, runCounts, spend, routing] = await Promise.all([
    listAgentBudgets(orgId).catch(() => []),
    listPlatformBudgets(orgId).catch(() => []),
    orgUsageTotals({ orgId }).catch(() => ({ spentCents: 0, tokens: 0, hardCentsLimit: null, hardTokenLimit: null })),
    countRunsLast24h(orgId).catch(() => ({ toolCalls: 0, workflowRuns: 0 })),
    spendRead,
    routingRead,
  ]);
  const filterLabel = Object.values(spendState.filters).filter(v => v !== undefined).map(String).join(' · ') || null;

  // The workspace's whole spend, read off the `platform:all` row rather than
  // summed over the agent rows. Summing the agents was the number this page
  // showed before #279, and it left out every embedding, rerank and generated
  // image — the spend most likely to surprise someone.
  const totalCents = orgTotals.spentCents;
  const topAgents = [...budgets]
    .sort((a, b) => (b.currentCents ?? 0) - (a.currentCents ?? 0))
    .slice(0, 5);
  // The non-agent surfaces, biggest first. `platform:all` is the total above,
  // not a line in its own breakdown.
  const platformSurfaces = platformBudgets
    .filter(b => b.agentSlug !== ORG_SCOPE_SLUG && (b.currentCents ?? 0) > 0)
    .sort((a, b) => (b.currentCents ?? 0) - (a.currentCents ?? 0));

  /**
   * Build one filtered Langfuse deep link, or null when tracing is off.
   * @param params - Langfuse trace-list query parameters.
   */
  const traceLink = (params: Record<string, string>): string | null => {
    if (!langfuseUrl) {
      return null;
    }
    return `${langfuseUrl}?${FILTER_ENCODE(params)}`;
  };

  const filterByOrg = traceLink({ tags: `org:${orgId}` });

  return (
    <>
      <TitleBar
        title="Observability"
        description="Spend + run volume across every LLM call. Open Langfuse for full trace search, slicing by user, feature, or agent."
      />

      <div className="space-y-6">
        {filterByOrg
          ? (
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <a href={filterByOrg} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Langfuse
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={traceLink({ tags: `org:${orgId}`, name: 'agent.chat' }) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View agent chat traces
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={traceLink({ tags: `org:${orgId}`, name: 'operation.run' }) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View operation traces
                  </a>
                </Button>
              </div>
            )
          : (
              <div className="text-sm text-muted-foreground">
                Trace search is unavailable because Langfuse is not configured for this
                deployment. The spend and run-volume numbers below come from this
                application's own tables and are unaffected. See
                {' '}
                <code className="rounded bg-background px-1 py-0.5">docs/deployment/observability.md</code>
                {' '}
                to connect Langfuse Cloud or a self-hosted instance.
              </div>
            )}

        {/* Airy pass (B-034b §4): numbers in a row between hairlines, no fills.
            The columns auto-fit, so a figure an extension adds (`spend.stats`)
            takes a column and an empty slot leaves no gap. */}
        <div className="grid gap-6 border-y border-border/70 py-5 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
          <StatCard
            label="Spend this period"
            value={`$${(totalCents / 100).toFixed(2)}`}
            hint={totalCents === 0 ? 'Nothing recorded this period.' : 'Everything this workspace spent: agent turns, embeddings, rerank, images.'}
          />
          <StatCard
            label="Runs (last 24h)"
            value={String(runCounts.toolCalls + runCounts.workflowRuns)}
            hint={`${runCounts.toolCalls} tool calls · ${runCounts.workflowRuns} workflow`}
          />
          <StatCard
            label="Active agents"
            value={String(topAgents.filter(a => (a.currentCents ?? 0) > 0).length)}
            hint={topAgents.length === 0 ? 'No usage in this period.' : 'Agents with non-zero spend.'}
          />
          <ExtensionSlot name="spend.stats" locale={locale} />
        </div>

        {spend && <SpendView state={spendState} result={spend} canReadOrg={canReadOrg} filterLabel={filterLabel} />}

        {routing && <RoutingSection summary={routing.summary} status={routing.status} periodLabel={spendState.period === 'today' ? 'today' : `last ${spendState.period.replace('d', ' days')}`} />}

        {platformSurfaces.length > 0 && (
          <div>
            <div className="mb-1 px-2 text-[15px] font-semibold">Spend outside an agent turn</div>
            <div className="divide-y divide-border/70 text-sm">
              {platformSurfaces.map(surface => (
                <div key={`${surface.agentSlug}-${surface.period}`} className="flex items-center justify-between rounded-lg px-2 py-3 transition-colors hover:bg-surface-hover">
                  <div className="flex items-center gap-3">
                    <LineChart className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{surface.feature ?? surface.agentSlug}</span>
                    <span className="text-xs text-muted-foreground">{surface.period}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>
                      $
                      {((surface.currentCents ?? 0) / 100).toFixed(2)}
                    </span>
                    {surface.feature && traceLink({ tags: `feature:${surface.feature}` }) && (
                      <Link
                        href={traceLink({ tags: `feature:${surface.feature}` }) as string}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        View traces ↗
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {topAgents.length > 0 && (
          <div>
            <div className="mb-1 px-2 text-[15px] font-semibold">Top agents by spend</div>
            <div className="divide-y divide-border/70 text-sm">
              {topAgents.map(agent => (
                <div key={`${agent.agentSlug}-${agent.period}`} className="flex items-center justify-between rounded-lg px-2 py-3 transition-colors hover:bg-surface-hover">
                  <div className="flex items-center gap-3">
                    <LineChart className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{agent.agentSlug}</span>
                    <span className="text-xs text-muted-foreground">{agent.period}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span>
                      $
                      {((agent.currentCents ?? 0) / 100).toFixed(2)}
                    </span>
                    {traceLink({ tags: `slug:${agent.agentSlug}` }) && (
                      <Link
                        href={traceLink({ tags: `slug:${agent.agentSlug}` }) as string}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        View traces ↗
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-border/70 pt-4 text-xs text-muted-foreground">
          The
          {' '}
          <code className="rounded bg-background px-1 py-0.5">agent_budget</code>
          {' '}
          table is the cap source enforced at request time. Langfuse is the audit/exploration surface. For
          caching-heavy workloads, Langfuse may report higher cost than this page until the public Langfuse
          API exposes per-usage-key pricing. See
          {' '}
          <Link href="/dashboard/docs/observability" className="underline">docs/observability</Link>
          .
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[12px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
