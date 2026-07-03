import { eq } from 'drizzle-orm';
import { CalendarClock, Compass, Database, GitBranch, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { knowledgeSourceSchema, missionSchema, workflowSchema } from '@/models/Schema';
import { describeMissionHeartbeat } from '@/services/MissionScheduleService';
import { describeWorkflowSchedule } from '@/services/WorkflowScheduleService';

/**
 * Automation — every clock and event subscription in one place.
 *
 * Three trigger families:
 *   - Mission heartbeats — standing responsibilities the team checks on a cron
 *   - Workflow triggers — cron-scheduled or event-subscribed fixed procedures
 *   - Source syncs — connector refresh crons
 *
 * Next-fire times are read from Temporal best-effort; when Temporal is
 * unreachable (or the worker hasn't materialized a schedule yet) the row
 * still renders from the authored config with a "not scheduled" hint.
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

  const [missions, workflows, sources] = await Promise.all([
    db.select().from(missionSchema).where(eq(missionSchema.orgId, orgId)),
    db.select().from(workflowSchema).where(eq(workflowSchema.orgId, orgId)),
    db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId)),
  ]);

  const heartbeats = await Promise.all(
    missions
      .filter(m => m.heartbeat && m.status === 'active')
      .map(async m => ({
        ...m,
        live: await describeMissionHeartbeat(orgId, m.slug),
      })),
  );

  const scheduled = await Promise.all(
    workflows
      .filter((w) => {
        const t = w.trigger as { type?: string };
        return t?.type === 'schedule' && w.status === 'active';
      })
      .map(async w => ({
        ...w,
        live: await describeWorkflowSchedule(orgId, w.slug),
      })),
  );

  const eventSubs = workflows.filter((w) => {
    const t = w.trigger as { type?: string };
    return t?.type === 'event' && w.status === 'active';
  });

  const syncing = sources.filter((s) => {
    const cfg = s.configJson as { schedule?: string } | null;
    return s.enabled === 'true' && cfg?.schedule;
  });

  const total = heartbeats.length + scheduled.length + eventSubs.length + syncing.length;

  return (
    <>
      <TitleBar
        title="Automation"
        description="Everything that runs without a human pressing a button — heartbeats, schedules, and event subscriptions"
      />

      {total === 0 && (
        <EmptyState
          icon={CalendarClock}
          title="Nothing is automated yet"
          description="Give a mission a heartbeat cron, a workflow a schedule or event trigger, or a source a sync schedule in your workspace YAML, then run workspace:apply."
        />
      )}

      {heartbeats.length > 0 && (
        <Section
          icon={<Compass className="size-4 text-primary" />}
          title="Mission heartbeats"
          description="Standing responsibilities — the team's lead checks the charter on this cadence and does only what's needed."
        >
          {heartbeats.map(m => (
            <Row
              key={m.slug}
              href="/dashboard/missions"
              name={m.name}
              slug={m.slug}
              cron={m.heartbeat!}
              next={m.live?.nextActionTimes?.[0] ?? null}
              paused={m.live?.paused ?? false}
              missing={!m.live}
            />
          ))}
        </Section>
      )}

      {scheduled.length > 0 && (
        <Section
          icon={<GitBranch className="size-4 text-primary" />}
          title="Scheduled workflows"
          description="Fixed procedures on a cron."
        >
          {scheduled.map((w) => {
            const t = w.trigger as { cron?: string };
            return (
              <Row
                key={w.slug}
                href={`/dashboard/workflows/${w.slug}`}
                name={w.name}
                slug={w.slug}
                cron={t.cron ?? ''}
                next={w.live?.nextActionTimes?.[0] ?? null}
                paused={w.live?.paused ?? false}
                missing={!w.live}
              />
            );
          })}
        </Section>
      )}

      {eventSubs.length > 0 && (
        <Section
          icon={<Zap className="size-4 text-primary" />}
          title="Event subscriptions"
          description="Workflows that start when a matching event hits POST /api/v1/events."
        >
          {eventSubs.map((w) => {
            const t = w.trigger as { event?: string; filter?: Record<string, unknown> };
            return (
              <div key={w.slug} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-0">
                <Link href={`/dashboard/workflows/${w.slug}`} className="font-medium hover:underline">{w.name}</Link>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{t.event}</code>
                {t.filter && (
                  <code className="font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(t.filter)}
                  </code>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {syncing.length > 0 && (
        <Section
          icon={<Database className="size-4 text-primary" />}
          title="Source syncs"
          description="Connector refresh crons — incremental from each source's checkpoint."
        >
          {syncing.map((s) => {
            const cfg = s.configJson as { schedule?: string };
            return (
              <div key={s.slug} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-0">
                <Link href="/dashboard/sources" className="font-medium hover:underline">{s.slug}</Link>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{cfg.schedule}</code>
              </div>
            );
          })}
        </Section>
      )}
    </>
  );
}

function Section(props: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 rounded-md border border-border p-5">
      <div className="mb-1 flex items-center gap-2 text-base font-semibold">
        {props.icon}
        {props.title}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{props.description}</p>
      {props.children}
    </div>
  );
}

function Row(props: {
  href: string;
  name: string;
  slug: string;
  cron: string;
  next: Date | null;
  paused: boolean;
  missing: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border py-2 text-sm last:border-0">
      <Link href={props.href} className="font-medium hover:underline">{props.name}</Link>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{props.cron}</code>
      {props.paused && <span className="text-[11px] text-amber-600">paused</span>}
      {props.next && (
        <span className="text-[11px] text-muted-foreground">
          next
          {' '}
          {props.next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}
        </span>
      )}
      {props.missing && (
        <span className="text-[11px] text-muted-foreground" title="Temporal has no live schedule for this yet — run workspace:apply with Temporal up.">
          not scheduled yet
        </span>
      )}
    </div>
  );
}
