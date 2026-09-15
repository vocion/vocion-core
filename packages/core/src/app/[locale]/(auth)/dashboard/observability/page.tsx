import { ExternalLink, LineChart } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { langfuseConfig } from '@/libs/Langfuse';
import { browserProjectId } from '@/libs/Langfuse/config';
import { listAgentBudgets } from '@/services/BudgetService';
import { countRunsLast24h } from '@/services/ObservabilityService';

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
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

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

  const [budgets, runCounts] = await Promise.all([
    listAgentBudgets(orgId).catch(() => []),
    countRunsLast24h(orgId).catch(() => ({ toolCalls: 0, workflowRuns: 0 })),
  ]);

  const totalCents = budgets.reduce((acc, b) => acc + (b.currentCents ?? 0), 0);
  const topAgents = [...budgets]
    .sort((a, b) => (b.currentCents ?? 0) - (a.currentCents ?? 0))
    .slice(0, 5);

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

        {/* Airy pass (B-034b §4): three numbers in a row between hairlines, no fills. */}
        <div className="grid gap-6 border-y border-border/70 py-5 sm:grid-cols-3">
          <StatCard
            label="Spend this period"
            value={`$${(totalCents / 100).toFixed(2)}`}
            hint={budgets.length === 0 ? 'No budgets configured yet.' : `Sum across ${budgets.length} agent budget${budgets.length === 1 ? '' : 's'}.`}
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
        </div>

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
