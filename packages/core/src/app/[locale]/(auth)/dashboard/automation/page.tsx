import { eq } from 'drizzle-orm';
import { CalendarClock, Cog, Compass, Database, GitBranch, History, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { AutomationCardStatus } from '@/features/dashboard/AutomationCardStatus';
import { checkResultOf } from '@/features/dashboard/automationResult';
import { AutomationTestRun } from '@/features/dashboard/AutomationTestRun';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { knowledgeSourceSchema } from '@/models/Schema';
import { listAgents } from '@/services/AgentService';
import {
  automationOwnerAgentSlug,
  automationSourceFreshness,
  describeAutomationSchedule,
  lastRunBySlug,
  listAutomations,
  scheduleHealth,
} from '@/services/AutomationService';
import { listMissions } from '@/services/MissionService';
import { isEntityStatus } from '@/types/Status';

/**
 * Automation — the WHEN of the system, as first-class objects.
 *
 * Each automation binds a trigger to a piece of work:
 *   when: a schedule (cron) or an event
 *   do:   run a workflow (deterministic procedure), check a mission (the team's
 *         judgment pass on a standing goal, optionally with an authored
 *         execution prompt), or run a built-in job (deterministic server code)
 *
 * This page is the DEFINITION side: what the automation does, when it fires,
 * who owns it, whether it is overdue, how fresh the data it reads is, and a
 * Test run control. The HISTORY side is its own surface — the run log at
 * `/dashboard/automation/runs`, and one automation's fires at
 * `/dashboard/automation/<slug>`.
 *
 * Authored in workspace/<org>/automations/*.yaml. Source-sync crons are
 * listed below for completeness (they're connector config, not automations).
 * @param props
 * @param props.params
 */
export default async function AutomationPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const [missions, agents, lastRuns] = await Promise.all([
    listMissions(orgId),
    listAgents(orgId),
    lastRunBySlug(orgId),
  ]);
  const missionAgentBySlug = new Map(missions.map(m => [m.slug, m.agentSlug]));
  const agentNameBySlug = new Map(agents.map(ag => [ag.slug, ag.name]));

  const automations = await Promise.all(
    (await listAutomations(orgId)).map(async (a) => {
      const live = a.whenConfig.schedule ? await describeAutomationSchedule(orgId, a.slug) : null;
      const lastRun = lastRuns.get(a.slug) ?? null;
      // The mirror slugs come from the last fire's own tool calls, so the
      // freshness shown is of the data this work actually reads.
      const mirrorSlugs = checkResultOf(lastRun?.result)?.mirror?.sources ?? [];
      return {
        ...a,
        live,
        ownerSlug: automationOwnerAgentSlug(a, missionAgentBySlug),
        lastRun,
        health: scheduleHealth({
          cron: a.whenConfig.schedule ?? null,
          lastFireAt: lastRun?.startedAt ?? null,
          paused: live?.paused,
        }),
        freshness: await automationSourceFreshness(orgId, mirrorSlugs),
      };
    }),
  );
  const sources = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId));
  const syncing = sources.filter((s) => {
    const cfg = s.configJson as { schedule?: string } | null;
    return s.enabled === 'true' && cfg?.schedule;
  });

  return (
    <>
      <TitleBar
        title="Automation"
        description="When things happen. Each automation binds a trigger — a schedule or an event — to a workflow run or a mission check."
        actions={(
          <Link
            href="/dashboard/automation/runs"
            title="Every fire, every automation"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <History className="size-3.5" />
            Run log
          </Link>
        )}
      />

      {automations.length === 0
        ? (
            <EmptyState
              icon={CalendarClock}
              title="No automations yet"
              description="Author one in workspace/<org>/automations/ — when: {schedule | event} → do: {workflow | checkMission} — and run workspace:apply."
            />
          )
        : (
            <div className="mb-6 flex flex-col gap-2">
              {automations.map((a) => {
                const next = a.live?.nextActionTimes?.[0] ?? null;
                return (
                  <div key={a.slug} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/dashboard/automation/${a.slug}`} className="text-sm font-medium hover:underline">
                            {a.name}
                          </Link>
                          <StatusPill status={a.status && isEntityStatus(a.status) ? a.status : 'inactive'} />
                        </div>

                        {/* What it does, in the author's words. Stored on the row
                            all along and never rendered until now. */}
                        {a.description && (
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{a.description}</p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {a.whenConfig.schedule
                            ? (
                                <span title={a.whenConfig.schedule}>
                                  {cronToText(a.whenConfig.schedule)}
                                </span>
                              )
                            : (
                                <span className="inline-flex items-center gap-1">
                                  <Zap className="size-3" />
                                  on
                                  {' '}
                                  <code className="font-mono">{a.whenConfig.event}</code>
                                </span>
                              )}
                          <span aria-hidden>→</span>
                          <DoTarget doConfig={a.doConfig} />
                          {a.ownerSlug && (
                            <>
                              <span aria-hidden>·</span>
                              <Link
                                href={`/dashboard/agents/${a.ownerSlug}`}
                                className="inline-flex items-center gap-1 hover:underline"
                                title={a.ownerAgentSlug ? 'Owning agent' : 'Owner inherited from the mission'}
                              >
                                <Compass className="size-3" />
                                {agentNameBySlug.get(a.ownerSlug) ?? a.ownerSlug}
                                {!a.ownerAgentSlug && <span className="text-muted-foreground/60">(via mission)</span>}
                              </Link>
                            </>
                          )}
                        </div>

                        {/* The operating parameters — for a job/workflow these ARE
                            the behaviour, so "what is it doing" is unanswerable
                            without them. */}
                        <Params input={a.doConfig.input} />
                      </div>

                      <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                        {a.live?.paused && <div className="text-amber-600">paused</div>}
                        {next && (
                          <div>
                            next
                            {' '}
                            {next.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        )}
                        {a.whenConfig.schedule && !a.live && (
                          <div title="Temporal has no live schedule yet — run workspace:apply with Temporal up.">not scheduled yet</div>
                        )}
                        <AutomationCardStatus run={a.lastRun} health={a.health} freshness={a.freshness} slug={a.slug} />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-border pt-3">
                      <AutomationTestRun
                        slug={a.slug}
                        kind={a.doConfig.checkMission ? 'mission_check' : a.doConfig.workflow ? 'workflow' : 'job'}
                        supportsDay={false}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

      {syncing.length > 0 && (
        <div className="rounded-md border border-border p-5">
          <div className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Database className="size-4 text-primary" />
            Source syncs
          </div>
          <p className="mb-3 text-sm text-muted-foreground">Connector refresh crons — configured on each connector, incremental from its checkpoint.</p>
          {syncing.map((s) => {
            const cfg = s.configJson as { schedule?: string };
            return (
              <div key={s.slug} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-0">
                <Link href="/dashboard/connectors" className="font-medium hover:underline">{s.slug}</Link>
                <span className="text-[11px] text-muted-foreground" title={cfg.schedule}>{cronToText(cfg.schedule ?? '')}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

type DoConfig = { workflow?: string; checkMission?: string; job?: string; input?: Record<string, unknown> };

/**
 * What the automation runs. Three do-types, not two: a `job` is a built-in
 * deterministic server task, and it has no page of its own to link to —
 * rendering it as a workflow produced an empty label and a dead link.
 * @param props
 * @param props.doConfig
 */
function DoTarget({ doConfig }: { doConfig: DoConfig }) {
  if (doConfig.checkMission) {
    return (
      <Link href="/dashboard/missions" className="inline-flex items-center gap-1 hover:underline">
        <Compass className="size-3" />
        check mission:
        {' '}
        {doConfig.checkMission}
      </Link>
    );
  }
  if (doConfig.workflow) {
    return (
      <Link href={`/dashboard/workflows/${doConfig.workflow}`} className="inline-flex items-center gap-1 hover:underline">
        <GitBranch className="size-3" />
        run workflow:
        {' '}
        {doConfig.workflow}
      </Link>
    );
  }
  if (doConfig.job) {
    return (
      <span className="inline-flex items-center gap-1" title="Built-in server job — deterministic code, not an agent or a workflow">
        <Cog className="size-3" />
        run job:
        {' '}
        <code className="font-mono">{doConfig.job}</code>
      </span>
    );
  }
  return <span className="text-amber-600">no work configured</span>;
}

/**
 * The `do.input` parameters, flattened one level so nested filters stay readable.
 * @param root0
 * @param root0.input
 */
function Params({ input }: { input: Record<string, unknown> | undefined }) {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) {
    return null;
  }
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="text-[11px]">
          <dt className="inline text-muted-foreground">
            {k}
            :
            {' '}
          </dt>
          <dd className="inline font-mono">{formatParam(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatParam(v: unknown): string {
  if (v === null || v === undefined) {
    return '—';
  }
  if (Array.isArray(v)) {
    return v.length === 0 ? 'any' : v.join(', ');
  }
  if (typeof v === 'object') {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}=${formatParam(val)}`)
      .join(' · ');
    return inner || '—';
  }
  return String(v);
}
