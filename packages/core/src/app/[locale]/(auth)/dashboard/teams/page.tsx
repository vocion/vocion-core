import type { TeamAgent, TeamView, WorkspaceLeadView } from '@/services/TeamService';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { createElement } from 'react';
import {
  consultCoverage,
  hasOwnerAnywhere,
  showSeedSampleButton,
  ungroupedAgents,
} from '@/features/dashboard/teams/helpers';
import { OwnerChip } from '@/features/dashboard/teams/OwnerChip';
import { TeamsEmptyState } from '@/features/dashboard/teams/TeamsEmptyState';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getWorkspaceLead, listTeamAgents, listTeams } from '@/services/TeamService';

/**
 * Teams — the org-chart hero (F1). One screen answers "who works for me
 * and who owns what": the workspace lead on top, the teams flat beneath
 * it (flat by construction — no team-in-team affordance exists), each
 * with a lead agent, its roster, and exactly one accountable human whose
 * explicit-vs-inherited provenance is labeled in plain text. Speaks only
 * names, roles, and teams — YAML stays in the empty/degraded states'
 * small print and behind team detail's "under the hood".
 */

export default async function TeamsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const [workspace, teams, agents] = orgId
    ? await Promise.all([getWorkspaceLead(orgId), listTeams(orgId), listTeamAgents(orgId)])
    : [{ lead: null, leadAgentSlug: null, accountable: null } satisfies WorkspaceLeadView, [], []];

  const ungrouped = ungroupedAgents(agents, teams, workspace.leadAgentSlug);

  return (
    <TeamsScreen
      workspace={workspace}
      teams={teams}
      ungrouped={ungrouped}
    />
  );
}

/**
 * Sync wrapper so the page body can use `useTranslations` (RSC-safe) —
 * the async page above only awaits data.
 * @param root0
 * @param root0.workspace - Workspace lead + default owner.
 * @param root0.teams - Resolved team views.
 * @param root0.ungrouped - Agents on no team (never dropped).
 */
function TeamsScreen({ workspace, teams, ungrouped }: {
  workspace: WorkspaceLeadView;
  teams: TeamView[];
  ungrouped: TeamAgent[];
}) {
  const t = useTranslations('Teams');
  const empty = showSeedSampleButton(teams.length);
  const ownerless = teams.length > 0 && !hasOwnerAnywhere(workspace, teams);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <TitleBar title={t('title_bar')} description={t('title_bar_description')} />
        <Link
          href="/dashboard/agents"
          className="mt-1 inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition hover:text-primary"
        >
          {t('all_agents')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {ownerless && (
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-[var(--brand-amber)]/40 bg-[var(--brand-amber-tint)] px-4 py-2.5 text-sm text-[var(--brand-amber-deep)]">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {t('no_owner_banner')}
        </div>
      )}

      {workspace.lead
        ? <WorkspaceLeadBand workspace={workspace} teams={teams} />
        : teams.length > 0 && <NoWorkspaceLeadCallout />}

      {empty
        ? (
            <div className="mt-6">
              <TeamsEmptyState />
            </div>
          )
        : (
            <>
              {/* hairline connector — one level, flat by design */}
              {workspace.lead && <div className="mx-auto h-6 w-px bg-border" aria-hidden />}

              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {teams.map(team => <TeamCard key={team.slug} team={team} />)}
              </div>
            </>
          )}

      {ungrouped.length > 0 && <UngroupedStrip agents={ungrouped} />}
    </>
  );
}

/**
 * The workspace-lead band — the org chart's top box and the lead's
 * everyday front door. Label set B (mock walkthrough): the band badge
 * says "Workspace Lead", distinct from the per-team "Team Lead" role
 * labels below it.
 * @param root0
 * @param root0.workspace - Workspace lead + default owner.
 * @param root0.teams - Team views (for consult coverage).
 */
function WorkspaceLeadBand({ workspace, teams }: { workspace: WorkspaceLeadView; teams: TeamView[] }) {
  const t = useTranslations('Teams');
  const lead = workspace.lead!;
  const a = agentAccent(lead.accent);
  const coverage = consultCoverage(teams);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-start" style={{ background: a.tint, borderColor: a.stripe }}>
      <div
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-background"
        style={{ background: a.stripe }}
      >
        {createElement(agentIcon(lead.icon, { primary: true }), { 'className': 'size-5', 'aria-hidden': true })}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-base leading-tight font-semibold">{lead.name}</h2>
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-background uppercase"
            style={{ background: a.ink }}
          >
            {t('workspace_lead_badge')}
          </span>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          {lead.description ?? t('workspace_lead_description')}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('accountable_label')}
            <OwnerChip accountable={workspace.accountable} />
          </span>
          {coverage.partial && (
            <span className="text-xs font-medium text-[var(--brand-amber-deep)]">
              {t('consults_partial', { consulted: coverage.consulted, total: coverage.total })}
            </span>
          )}
        </div>

        <div className="mt-3.5 flex flex-wrap gap-2">
          <Link
            href={`/dashboard/chat?agent=${encodeURIComponent(lead.slug)}&prompt=${encodeURIComponent(t('ask_quarter_prompt'))}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold text-background transition hover:opacity-90"
            style={{ background: a.ink }}
          >
            {t('ask_quarter')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <Link
            href={`/dashboard/agents/${lead.slug}`}
            className="inline-flex items-center rounded-lg border border-border bg-background px-3.5 py-1.5 text-sm font-medium transition hover:border-primary/30"
          >
            {t('view_profile')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The degraded top band when no workspace lead is configured — a callout, never a blank; the org chart still renders beneath it. */
function NoWorkspaceLeadCallout() {
  const t = useTranslations('Teams');
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-5 py-4">
      <div className="font-display text-sm font-semibold">{t('no_workspace_lead_title')}</div>
      <p className="mt-1 text-sm text-muted-foreground">{t('no_workspace_lead_body')}</p>
      <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/70">{t('no_workspace_lead_hint')}</p>
    </div>
  );
}

/**
 * One team box — agents-page card anatomy (accent stripe, icon tile,
 * pills, footer meta) with the F1 additions: the lead row with its
 * "«Team» Team Lead" role label and the owner row with explicit vs
 * inherited provenance.
 * @param root0
 * @param root0.team - The resolved team view.
 */
function TeamCard({ team }: { team: TeamView }) {
  const t = useTranslations('Teams');
  const a = agentAccent(team.lead?.accent);
  const specialists = team.members.filter(m => m.slug !== team.leadAgentSlug);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 pt-6 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      {/* accent top stripe */}
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: a.stripe }} aria-hidden />

      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/dashboard/teams/${team.slug}`} className="min-w-0">
          <h3 className="truncate font-display text-base leading-tight font-semibold hover:text-primary">{team.name}</h3>
        </Link>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('agent_count', { count: team.members.length })}
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{t('lead_label')}</div>
        {team.lead
          ? (
              <Link href={`/dashboard/agents/${team.lead.slug}`} className="inline-flex items-center gap-2">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-background"
                  style={{ background: a.stripe }}
                >
                  {createElement(agentIcon(team.lead.icon, { primary: true }), { 'className': 'size-3', 'aria-hidden': true })}
                </span>
                <span className="text-sm font-semibold hover:text-primary">{team.lead.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  ·
                  {' '}
                  {t('team_lead_role', { team: team.name })}
                </span>
              </Link>
            )
          : (
              <div className="rounded-lg border border-dashed border-[var(--brand-amber)]/50 bg-[var(--brand-amber-tint)]/50 px-3 py-2">
                <p className="text-xs text-[var(--brand-amber-deep)]">
                  <TriangleAlert className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                  {t('no_lead_warning')}
                </p>
                <Link
                  href={`/dashboard/teams/${team.slug}#under-the-hood`}
                  className="mt-1 inline-block text-xs font-semibold text-[var(--brand-amber-deep)] underline underline-offset-2"
                >
                  {t('choose_lead')}
                </Link>
              </div>
            )}
      </div>

      {specialists.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {specialists.map(s => (
            <Link
              key={s.slug}
              href={`/dashboard/agents/${s.slug}`}
              className="rounded-full px-2 py-0.5 text-xs font-medium transition hover:opacity-80"
              style={{ background: a.tint, color: a.ink }}
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/60 pt-3">
        <div>
          <div className="mb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{t('owner_label')}</div>
          <OwnerChip accountable={team.accountable} />
        </div>
        <Link
          href={`/dashboard/teams/${team.slug}`}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground/60 transition group-hover:text-primary"
        >
          {t('view_team')}
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Agents on no team — rendered, never dropped (prod has two parentless
 * agents today). Each chip goes to the agent's profile.
 * @param root0
 * @param root0.agents - The ungrouped agents.
 */
function UngroupedStrip({ agents }: { agents: TeamAgent[] }) {
  const t = useTranslations('Teams');
  return (
    <section className="mt-8">
      <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t('ungrouped_title')}</div>
      <p className="mb-3 text-xs text-muted-foreground">{t('ungrouped_hint', { count: agents.length })}</p>
      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => {
          const a = agentAccent(agent.accent);
          return (
            <Link
              key={agent.slug}
              href={`/dashboard/agents/${agent.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium transition hover:border-primary/40 hover:text-primary"
            >
              <span style={{ color: a.ink }}>
                {createElement(agentIcon(agent.icon), { 'className': 'size-3.5', 'aria-hidden': true })}
              </span>
              {agent.name}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
