import { Bot, Compass, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { CatalogCard } from '@/components/ui/catalog-card';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listTeams } from '@/services/AgentService';
import { listSkills } from '@/services/SkillService';

/**
 * Agents — ONE roster, presented as teams where the workspace defines them.
 * A team is a Lead agent + its specialists (you brief the Lead; it plans and
 * dispatches). Agents without a `team` fall into an Unassigned section, so a
 * deployment with no team structure still reads as a plain agent list.
 * (The old /dashboard/teams page redirects here.)
 */

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

export default async function AgentsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const teams = orgId ? await listTeams(orgId) : [];
  // Skill slug → display name, so each agent card shows its actual skills.
  const skills = orgId ? await listSkills(orgId) : [];
  const skillName = new Map(skills.map((s: { slug: string; name: string }) => [s.slug, s.name]));
  const skillChips = (slugs: string[] | null | undefined) =>
    (slugs ?? []).map(s => skillName.get(s) ?? s);
  const named = teams.filter(t => t.team !== 'ungrouped' || t.lead || t.specialists.length > 0);
  const total = named.reduce((n, t) => n + (t.lead ? 1 : 0) + t.specialists.length, 0);

  return (
    <>
      <TitleBar
        title="Agents"
        description="Your AI staff, organized as teams: brief a Lead, it plans and dispatches its specialists. Teams run Missions + Workflows."
      />

      {total === 0
        ? (
            <EmptyState
              icon={Bot}
              title="No agents yet"
              description="Author agents in workspace/<org>/agents/ (add `team` + `role: lead|specialist` to group them into teams) and run workspace:apply."
              action={{ label: 'How agents + teams work', href: 'https://www.vocion.ai/docs/features/teams' }}
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
                        footer={(
                          <span className="flex flex-wrap gap-1">
                            <span className="mr-1">Coordinates the team ·</span>
                            {skillChips(team.lead.skillSlugs).map(n => (
                              <span key={n} className="rounded-full border border-border px-1.5 py-0.5 text-[10px]">{n}</span>
                            ))}
                          </span>
                        )}
                      />
                    </div>
                  )}

                  {team.specialists.length > 0 && (
                    <>
                      <div className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Specialists</div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {team.specialists.map((a) => {
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
                                <span className="flex flex-wrap gap-1">
                                  {skillChips(a.skillSlugs).length > 0
                                    ? skillChips(a.skillSlugs).map(n => (
                                        <span key={n} className="rounded-full border border-border px-1.5 py-0.5 text-[10px]">{n}</span>
                                      ))
                                    : <span>No skills wired</span>}
                                </span>
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
