import { ExternalLink, LineChart } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
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

  const langfuseBase = process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3200';
  const langfuseProject = process.env.LANGFUSE_PROJECT_ID ?? 'demo';
  const langfuseUrl = `${langfuseBase}/project/${langfuseProject}/traces`;

  if (!orgId) {
    return (
      <>
        <TitleBar
          title="Observability"
          description="Per-org / per-user / per-feature LLM cost + run volume, powered by Langfuse."
        />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          Sign in to an organization to see spend and run volume for your workspace.
        </div>
      </>
    );
  }

  const [budgets, runCounts] = await Promise.all([
    listAgentBudgets(orgId).catch(() => []),
    countRunsLast24h(orgId).catch(() => ({ skillRuns: 0, workflowRuns: 0 })),
  ]);

  const totalCents = budgets.reduce((acc, b) => acc + (b.currentCents ?? 0), 0);
  const topAgents = [...budgets]
    .sort((a, b) => (b.currentCents ?? 0) - (a.currentCents ?? 0))
    .slice(0, 5);

  const filterByOrg = `${langfuseUrl}?${FILTER_ENCODE({ tags: `org:${orgId}` })}`;

  return (
    <>
      <TitleBar
        title="Observability"
        description="Spend + run volume across every LLM call. Open Langfuse for full trace search, slicing by user, feature, or agent."
      />

      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={filterByOrg} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open in Langfuse
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={`${langfuseUrl}?${FILTER_ENCODE({ tags: `org:${orgId}`, name: 'agent.chat' })}`}
              target="_blank"
              rel="noreferrer"
            >
              View agent chat traces
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={`${langfuseUrl}?${FILTER_ENCODE({ tags: `org:${orgId}`, name: 'operation.run' })}`}
              target="_blank"
              rel="noreferrer"
            >
              View operation traces
            </a>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Spend this period"
            value={`$${(totalCents / 100).toFixed(2)}`}
            hint={budgets.length === 0 ? 'No budgets configured yet.' : `Sum across ${budgets.length} agent budget${budgets.length === 1 ? '' : 's'}.`}
          />
          <StatCard
            label="Runs (last 24h)"
            value={String(runCounts.skillRuns + runCounts.workflowRuns)}
            hint={`${runCounts.skillRuns} operation · ${runCounts.workflowRuns} workflow`}
          />
          <StatCard
            label="Active agents"
            value={String(topAgents.filter(a => (a.currentCents ?? 0) > 0).length)}
            hint={topAgents.length === 0 ? 'No usage in this period.' : 'Agents with non-zero spend.'}
          />
        </div>

        {topAgents.length > 0 && (
          <div className="rounded-md border border-border">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">Top agents by spend</div>
            <div className="divide-y divide-border text-sm">
              {topAgents.map(agent => (
                <div key={`${agent.agentSlug}-${agent.period}`} className="flex items-center justify-between px-4 py-3">
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
                    <Link
                      href={`${langfuseUrl}?${FILTER_ENCODE({ tags: `slug:${agent.agentSlug}` })}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      View traces ↗
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
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
    <div className="rounded-md border border-border p-4">
      <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-display text-2xl tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
