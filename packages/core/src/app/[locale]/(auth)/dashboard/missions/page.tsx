import { Compass, Plus } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { TriggerBadge } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listMissionRuns, listMissions } from '@/services/MissionService';

function StatusChip({ status }: { status: string }) {
  const tone = status === 'completed'
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : status === 'failed' || status === 'cancelled'
      ? 'bg-muted text-muted-foreground'
      : status === 'awaiting_review' || status === 'paused'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-primary/10 text-primary';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{status.replace('_', ' ')}</span>;
}

export default async function MissionsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const templates = orgId ? await listMissions(orgId) : [];
  const runs = orgId ? await listMissionRuns(orgId, { limit: 25 }) : [];

  return (
    <>
      <TitleBar
        title="Missions"
        description="Open-ended team work. Brief the assignment, watch the team plan and run it, approve what matters, and teach it as you go."
      />

      <div className="mb-6">
        <Link href="/dashboard/missions/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="size-4" />
          Start a mission
        </Link>
      </div>

      <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Active &amp; recent</h2>
      {runs.length === 0
        ? (
            <EmptyState
              icon={Compass}
              title="No missions yet"
              description="Give your AI team an open-ended assignment — they'll plan it, split the work, produce artifacts, and pause for your approval where it matters."
              action={{ label: 'Start your first mission', href: '/dashboard/missions/new' }}
            />
          )
        : (
            <div className="mb-8 flex flex-col gap-2">
              {runs.map(run => (
                <Link
                  key={run.id}
                  href={`/dashboard/missions/runs/${run.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background p-4 transition hover:border-primary/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{run.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{run.goal ?? run.brief}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {run.plan?.tasks?.length ?? 0}
                    {' '}
                    tasks
                  </span>
                  <StatusChip status={run.status} />
                </Link>
              ))}
            </div>
          )}

      {templates.length > 0 && (
        <>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Standing missions (responsibilities)</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            A mission is a charter a team owns, not a one-off. Missions with a heartbeat get checked on that cadence — the lead reviews the charter, does only what's needed, and reports. Any mission can also be briefed manually.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map(t => (
              <Link
                key={t.id}
                href={`/dashboard/missions/new?template=${t.slug}`}
                className="rounded-lg border border-border bg-background p-4 transition hover:border-primary/30"
              >
                <div className="text-sm font-medium">{t.name}</div>
                {t.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <TriggerBadge trigger={null} heartbeat={t.heartbeat} />
                  <span>
                    Team:
                    {' '}
                    {1 + t.defaultTeam.members.length}
                    {' '}
                    agents
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
