import { Activity, Compass, Plus } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { TriggerBadge } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listMissions } from '@/services/MissionService';

export default async function MissionsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const templates = orgId ? await listMissions(orgId) : [];

  return (
    <>
      <TitleBar
        title="Missions"
        description="Objectives a team owns — not procedures. Brief a goal in plain language, or let a standing mission check itself on its schedule. Deterministic routines belong in Workflows."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/dashboard/missions/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="size-4" />
          Start a mission
        </Link>
        <Link href="/dashboard/activity?kind=mission" className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground">
          <Activity className="size-4" />
          Recent mission activity
        </Link>
      </div>

      {templates.length === 0
        ? (
            <EmptyState
              icon={Compass}
              title="No standing missions"
              description="Missions are objectives a team owns — 'no lead goes cold' — not step sequences. Add one from the workspace repo, or start an ad-hoc mission above."
              action={{ label: 'Start a mission', href: '/dashboard/missions/new' }}
            />
          )
        : (
            <>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Standing missions</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Missions with a schedule get checked on that cadence: the lead reviews the goal against current state, does only what's needed, and reports. Repeatable procedures should be Workflows instead.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map(t => (
                  <Link
                    key={t.id}
                    href={`/dashboard/missions/${t.slug}`}
                    className="rounded-lg border border-border bg-background p-4 transition hover:border-primary/30"
                  >
                    <div className="text-sm font-medium">{t.name}</div>
                    {t.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <TriggerBadge trigger={null} schedule={t.schedule} />
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
