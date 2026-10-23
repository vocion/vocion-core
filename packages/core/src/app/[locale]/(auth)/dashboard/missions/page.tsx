import { Activity, Compass, Plus } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { EmptyState } from '@/components/ui/empty-state';
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
    <ListPage
      title="Missions"
      description="Goals a team owns, like ‘no lead goes cold’, checked on their own schedule."
    >
      <div className="mb-4 flex items-center gap-2 sm:mb-6 sm:gap-3">
        <Link href="/dashboard/missions/new" className={buttonVariants({ className: 'shrink-0' })}>
          <Plus className="size-4" />
          Start a mission
        </Link>
        <Link href="/dashboard/activity?kind=mission" className={buttonVariants({ variant: 'outline', className: 'min-w-0' })}>
          <Activity className="size-4 shrink-0" />
          <span className="truncate">Recent mission activity</span>
        </Link>
      </div>

      {templates.length === 0
        ? (
            <EmptyState
              icon={Compass}
              title="No standing missions"
              description="A mission is a goal a team owns and checks on its own, not a list of steps."
              action={{ label: 'Start a mission', href: '/dashboard/missions/new' }}
            />
          )
        : (
            <>
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Standing missions</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Missions with a schedule get checked on that cadence: the lead reviews the goal against current state, does only what's needed, and reports. Repeatable procedures should be Workflows instead.
              </p>
              <ListRows>
                {templates.map(t => (
                  <ListRow
                    key={t.id}
                    href={`/dashboard/missions/${t.slug}`}
                    title={t.name}
                    subline={(
                      <Subline
                        separator="·"
                        segments={[
                          <TriggerBadge key="trigger" trigger={null} schedule={t.schedule} />,
                          `Agent: ${t.agentSlug}`,
                          t.description,
                        ]}
                      />
                    )}
                  />
                ))}
              </ListRows>
            </>
          )}
    </ListPage>
  );
}
