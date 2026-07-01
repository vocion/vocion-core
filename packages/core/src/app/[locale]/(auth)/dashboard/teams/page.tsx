import { Bot, Compass, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { CatalogCard } from '@/components/ui/catalog-card';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listTeams } from '@/services/AgentService';

function accentCssVar(name: string | null | undefined): string {
  if (name === 'teal') {
    return 'var(--brand-teal)';
  }
  if (name === 'violet' || name === 'indigo') {
    return 'var(--brand-violet, var(--brand-amber))';
  }
  return 'var(--brand-amber)';
}

function titleCase(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default async function TeamsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const teams = orgId ? await listTeams(orgId) : [];
  const named = teams.filter(t => t.team !== 'ungrouped' || t.lead || t.specialists.length > 0);
  const total = named.reduce((n, t) => n + (t.lead ? 1 : 0) + t.specialists.length, 0);

  return (
    <>
      <TitleBar
        title="Teams"
        description="A team is a Lead agent + its specialists. You brief the Lead; it plans, coordinates, and dispatches the specialists. Teams run Missions + Workflows."
      />

      {total === 0
        ? (
            <EmptyState
              icon={Users}
              title="No teams yet"
              description="Author agents with a `team` + `role: lead|specialist` in workspace/<org>/agents/ and run workspace:apply. A team is one lead + its specialists."
              action={{ label: 'How teams work', href: '/dashboard/docs/docs/concepts/agents' }}
            />
          )
        : (
            <div className="space-y-8">
              {named.map(team => (
                <section key={team.team}>
                  <div className="mb-3 flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    <h2 className="text-lg font-semibold tracking-tight">
                      {team.team === 'ungrouped' ? 'Unassigned agents' : titleCase(team.team)}
                    </h2>
                    <span className="text-sm text-muted-foreground">
                      {team.lead ? '1 lead · ' : ''}
                      {team.specialists.length}
                      {' '}
                      specialist
                      {team.specialists.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {team.lead && (
                    <div className="mb-3">
                      <div className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Lead · your point of contact</div>
                      <CatalogCard
                        href={`/dashboard/agents/${team.lead.slug}`}
                        icon={Compass}
                        title={team.lead.name}
                        slug={team.lead.slug}
                        description={team.lead.description ?? undefined}
                        status={team.lead.active === 'true' ? 'active' : 'inactive'}
                        accentColor={accentCssVar(team.lead.accent)}
                        footer={<>Coordinates the team · runs missions</>}
                      />
                    </div>
                  )}

                  {team.specialists.length > 0 && (
                    <>
                      <div className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Specialists</div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {team.specialists.map((a) => {
                          const skillCount = a.skillSlugs?.length ?? 0;
                          return (
                            <CatalogCard
                              key={a.id}
                              href={`/dashboard/agents/${a.slug}`}
                              icon={Bot}
                              title={a.name}
                              slug={a.slug}
                              description={a.description ?? undefined}
                              status={a.active === 'true' ? 'active' : 'inactive'}
                              accentColor={accentCssVar(a.accent)}
                              footer={(
                                <>
                                  {skillCount}
                                  {' '}
                                  skill
                                  {skillCount === 1 ? '' : 's'}
                                </>
                              )}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>
              ))}
            </div>
          )}
    </>
  );
}
