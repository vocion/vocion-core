import { eq } from 'drizzle-orm';
import { CalendarClock, Compass, Database, GitBranch, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { knowledgeSourceSchema } from '@/models/Schema';
import { describeAutomationSchedule, listAutomations } from '@/services/AutomationService';
import { isEntityStatus } from '@/types/Status';

/**
 * Automation — the WHEN of the system, as first-class objects.
 *
 * Each automation binds a trigger to a piece of work:
 *   when: a schedule (cron) or an event
 *   do:   run a workflow (deterministic procedure) or check a mission
 *         (the team's judgment pass on a standing goal)
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

  const automations = await Promise.all(
    (await listAutomations(orgId)).map(async a => ({
      ...a,
      live: a.whenConfig.schedule ? await describeAutomationSchedule(orgId, a.slug) : null,
    })),
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
                const isCheck = !!a.doConfig.checkMission;
                const target = a.doConfig.workflow ?? a.doConfig.checkMission ?? '';
                const next = a.live?.nextActionTimes?.[0] ?? null;
                return (
                  <div key={a.slug} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-4">
                    <CalendarClock className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{a.name}</span>
                        <StatusPill status={a.status && isEntityStatus(a.status) ? a.status : 'inactive'} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
                        <Link
                          href={isCheck ? '/dashboard/missions' : `/dashboard/workflows/${target}`}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {isCheck ? <Compass className="size-3" /> : <GitBranch className="size-3" />}
                          {isCheck ? `check mission: ${target}` : `run workflow: ${target}`}
                        </Link>
                      </div>
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
          <p className="mb-3 text-sm text-muted-foreground">Connector refresh crons — configured on each source, incremental from its checkpoint.</p>
          {syncing.map((s) => {
            const cfg = s.configJson as { schedule?: string };
            return (
              <div key={s.slug} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-0">
                <Link href="/dashboard/sources" className="font-medium hover:underline">{s.slug}</Link>
                <span className="text-[11px] text-muted-foreground" title={cfg.schedule}>{cronToText(cfg.schedule ?? '')}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
