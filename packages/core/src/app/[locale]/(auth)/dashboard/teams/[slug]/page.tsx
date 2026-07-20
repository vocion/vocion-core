import type { TeamView } from '@/services/TeamService';
import { ArrowLeft, ArrowUpRight, TriangleAlert, Users, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createElement } from 'react';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { RailGroup } from '@/features/dashboard/RailGroup';
import { approvalBoundary, ownerProvenance } from '@/features/dashboard/teams/helpers';
import { OwnerChip } from '@/features/dashboard/teams/OwnerChip';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getWorkspaceDirtyState } from '@/libs/workspace/dirty';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
import { listAgents } from '@/services/AgentService';
import { listSkills } from '@/services/SkillService';
import { getTeam } from '@/services/TeamService';

/**
 * Team detail — one readable page per team, same layout grammar as the
 * agent profile: hero, flat left rail (owner + lead + the plain-language
 * approval boundary), main column (member roster, lead first). YAML gets
 * the same demotion the agent profile gives the system prompt: a
 * collapsed "under the hood" disclosure at the bottom — the only place
 * the slug appears.
 */

export default async function TeamDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  if (!orgId) {
    return notFound();
  }
  const team = await getTeam(orgId, slug);
  if (!team) {
    return notFound();
  }

  const [agents, skills] = await Promise.all([
    listAgents(orgId),
    listSkills(orgId),
  ]);
  const memberSlugs = new Set(team.members.map(m => m.slug));
  const boundary = approvalBoundary(
    agents.filter(a => memberSlugs.has(a.slug)).map(a => a.skillSlugs),
    skills.map(s => ({ slug: s.slug, category: s.category, requiresApproval: s.requiresApproval })),
  );

  const sourceFiles = readPrimitiveFiles('team', slug);
  const dirtyState = getWorkspaceDirtyState();

  return (
    <TeamDetailScreen
      team={team}
      boundary={boundary}
      files={sourceFiles?.files ?? null}
      editInGitPath={sourceFiles?.editInGitPath ?? null}
      dirty={dirtyState.dirty}
      dirtyFiles={dirtyState.changedFiles}
    />
  );
}

/**
 * Sync body so `useTranslations` works (RSC); the async page only loads.
 * @param root0
 * @param root0.team - The resolved team view.
 * @param root0.boundary - Wired-skill counts for the approval boundary line.
 * @param root0.boundary.total
 * @param root0.boundary.gated
 * @param root0.files - The team's workspace YAML, when readable on this host.
 * @param root0.editInGitPath - Path hint for the files panel.
 * @param root0.dirty - Workspace drift flag.
 * @param root0.dirtyFiles - Changed files, when drifted.
 */
function TeamDetailScreen({ team, boundary, files, editInGitPath, dirty, dirtyFiles }: {
  team: TeamView;
  boundary: { total: number; gated: number };
  files: React.ComponentProps<typeof PrimitiveFiles>['files'] | null;
  editInGitPath: string | null;
  dirty: boolean;
  dirtyFiles: string[];
}) {
  const t = useTranslations('Teams');
  const a = agentAccent(team.lead?.accent);
  const provenance = ownerProvenance(team.accountable);

  return (
    <>
      <div className="mb-5">
        <Link
          href="/dashboard/teams"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('back_to_teams')}
        </Link>
      </div>

      {/* ── Hero — same clean header as the agent profile ─────────────── */}
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-start sm:gap-5">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: a.tint, color: a.ink }}
        >
          <Users className="size-7" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight">{team.name}</h1>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
              style={{ background: a.tint, color: a.ink }}
            >
              {t('team_badge')}
            </span>
          </div>

          <div className="mt-1.5 font-mono text-[11px] tracking-wide text-muted-foreground">
            {t('agent_count', { count: team.members.length })}
          </div>

          {team.description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{team.description}</p>
          )}
        </div>
      </header>

      {/* ── Body: flat left rail + member roster ──────────────────────── */}
      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="order-2 flex flex-col gap-5 rounded-xl border border-border/60 bg-muted/40 p-5 lg:sticky lg:top-6 lg:order-1 lg:self-start">
          <RailGroup label={t('rail_owner')}>
            <OwnerChip accountable={team.accountable} />
            {provenance === 'missing' && (
              <p className="mt-1.5 text-xs text-muted-foreground">{t('no_owner_banner')}</p>
            )}
          </RailGroup>

          <RailGroup label={t('rail_lead')}>
            {team.lead
              ? (
                  <Link href={`/dashboard/agents/${team.lead.slug}`} className="group inline-flex items-center gap-2">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-md text-background"
                      style={{ background: a.stripe }}
                    >
                      {createElement(agentIcon(team.lead.icon, { primary: true }), { 'className': 'size-3', 'aria-hidden': true })}
                    </span>
                    <span className="text-sm font-medium group-hover:text-primary">{team.lead.name}</span>
                  </Link>
                )
              : (
                  <div>
                    <p className="text-xs text-[var(--brand-amber-deep)]">
                      <TriangleAlert className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                      {t('rail_lead_missing')}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{t('rail_lead_missing_hint')}</p>
                  </div>
                )}
          </RailGroup>

          <RailGroup label={t('rail_boundary')}>
            {boundary.total === 0
              ? <p className="text-xs text-muted-foreground">{t('boundary_none')}</p>
              : (
                  <ul className="flex flex-col gap-2 text-xs">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: 'var(--brand-teal)' }} aria-hidden />
                      <span className="text-foreground/90">{t('boundary_reads')}</span>
                    </li>
                    {boundary.gated > 0 && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: 'var(--brand-amber)' }} aria-hidden />
                        <span>
                          <span className="text-[var(--brand-amber-deep)]">{t('boundary_gated', { count: boundary.gated })}</span>
                          {' '}
                          <Link href="/dashboard/review" className="font-medium text-foreground/70 underline underline-offset-2 hover:text-primary">
                            {t('boundary_review_link')}
                          </Link>
                        </span>
                      </li>
                    )}
                  </ul>
                )}
          </RailGroup>
        </aside>

        {/* Main column — the people on this team + the demoted YAML */}
        <div className="order-1 flex flex-col gap-8 lg:order-2">
          <section>
            <h2 className="mb-1 font-display text-base font-semibold">{t('members_title')}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{t('members_description')}</p>
            {team.members.length === 0
              ? (
                  <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
                    <p className="text-sm text-muted-foreground">{t('no_members_title')}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/70">{t('no_members_hint', { slug: team.slug })}</p>
                  </div>
                )
              : (
                  <div className="divide-y divide-border/60 border-y border-border/60">
                    {team.members.map((member) => {
                      const isLead = member.slug === team.leadAgentSlug;
                      const mAccent = agentAccent(member.accent);
                      return (
                        <Link
                          key={member.slug}
                          href={`/dashboard/agents/${member.slug}`}
                          className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3.5 transition hover:bg-muted/30"
                        >
                          <span className="shrink-0" style={{ color: mAccent.ink }}>
                            {createElement(agentIcon(member.icon, { primary: isLead }), { 'className': 'size-5', 'aria-hidden': true })}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium group-hover:text-primary">{member.name}</span>
                              {isLead && (
                                <span
                                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                                  style={{ background: mAccent.tint, color: mAccent.ink }}
                                >
                                  {t('team_lead_badge')}
                                </span>
                              )}
                            </span>
                            {member.description && (
                              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{member.description}</p>
                            )}
                          </div>
                          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition group-hover:text-primary" />
                        </Link>
                      );
                    })}
                  </div>
                )}
          </section>

          {/* Under the hood — the only place the slug + YAML appear. */}
          <section id="under-the-hood">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 border-b border-border/60 pb-2.5 text-sm">
                <Wrench className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-display font-semibold">{t('under_the_hood')}</span>
                <span className="ml-auto text-[11px] text-muted-foreground group-open:hidden">{t('under_show')}</span>
                <span className="ml-auto hidden text-[11px] text-muted-foreground group-open:inline">{t('under_hide')}</span>
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">{t('under_slug')}</span>
                  <span className="font-mono text-foreground/90">{team.slug}</span>
                </div>
                {files && editInGitPath && (
                  <PrimitiveFiles
                    files={files}
                    editInGitPath={editInGitPath}
                    dirty={dirty}
                    dirtyFiles={dirtyFiles}
                  />
                )}
              </div>
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
