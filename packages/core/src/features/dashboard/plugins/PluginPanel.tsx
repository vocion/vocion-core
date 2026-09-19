import type { PluginPanelAction, PluginPanelAgent, PluginPanelLearning } from './pluginPanelPlan';
import type { TeamMeasure } from '@/models/Schema';
import type { MeasureReading } from '@/services/team-report';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { ChevronDown } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';
import { measureValue } from '@/features/dashboard/team-report/format';
import { ProvenanceChip } from '@/features/dashboard/team-report/ProvenanceChip';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { listPluginSlugs, loadPlugin, pluginContents, readPluginTeams } from '@/libs/workspace/plugins';
import { effectiveMeasures } from '@/libs/workspace/team-export';
import { actionRunSchema, agentSchema, learningCandidateSchema, memoryNamespaceSchema, teamSchema } from '@/models/Schema';
import { enabledPluginsForOrg } from '@/services/PluginService';
import { actionAgentSlug, readTeamMeasures, windowPhrase } from '@/services/team-report';
import { actionPill, learningPill, planPluginPanel } from './pluginPanelPlan';

/**
 * How a plugin is doing — the outcome panel a plugin's own page carries.
 *
 * Chris of the Proposals page, 2026-09-18: *"can I get more than just a list.
 * Should I see the Agents and their measures. Links to Playbooks that can be
 * customized. List of learnings / updates generated through use?"* A list of
 * rows is the activity; this is the outcome layer above it, and it is the same
 * panel on every plugin surface rather than one built for proposals — the
 * plugin's manifest and its directory say what to show, so the fourth plugin
 * costs nothing (principles 6, 7 and 12).
 *
 * Four groups, each derived: the measures its team declared (read exactly as
 * the team report reads them, provenance and all), its agents, its skills and
 * playbooks with the path that overrides each one, and what use has taught it
 * — learning candidates on its agents' steps and the proposals people decided.
 * Collapsed by default: the list underneath is what the page is for
 * (principle 9 — hide complexity, never hide truth).
 *
 * Renders NOTHING when the plugin is off for this org, so a surface can mount
 * it unconditionally.
 * @param props
 * @param props.orgId - The project.
 * @param props.slug - The plugin whose panel this is.
 */
export async function PluginPanel({ orgId, slug }: { orgId: string; slug: string }) {
  if (!listPluginSlugs().includes(slug) || !(await enabledPluginsForOrg(orgId)).includes(slug)) {
    return null;
  }
  const plugin = loadPlugin(slug);
  const contents = pluginContents(plugin);
  const manifestTeams = readPluginTeams(plugin);
  const agentSlugs = contents.agents;
  const teamSlugs = manifestTeams.map(t => t.slug);

  const [teamRows, agentRows] = await Promise.all([
    teamSlugs.length > 0
      ? db.select({ slug: teamSchema.slug, name: teamSchema.name, measures: teamSchema.measures, kpis: teamSchema.kpis })
          .from(teamSchema)
          .where(and(eq(teamSchema.orgId, orgId), inArray(teamSchema.slug, teamSlugs)))
      : Promise.resolve([]),
    agentSlugs.length > 0
      ? db.select({ slug: agentSchema.slug, name: agentSchema.name, description: agentSchema.description, teamSlug: agentSchema.teamSlug })
          .from(agentSchema)
          .where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, agentSlugs)))
      : Promise.resolve([]),
  ]);

  // The workspace may have patched the team by slug, so the LIVE measures are
  // the ones to read; the plugin's own file is the fallback for a team the
  // apply has not written yet.
  const teams = manifestTeams.map((t) => {
    const row = teamRows.find(r => r.slug === t.slug);
    return {
      slug: t.slug,
      name: row?.name ?? t.name,
      measures: row ? effectiveMeasures(row) : (t.measures as TeamMeasure[]),
    };
  });

  const [readings, learnings, actions] = await Promise.all([
    teams.length > 0
      ? readTeamMeasures(orgId, teams.map(t => ({ teamSlug: t.slug, agentSlugs, measures: t.measures })))
      : Promise.resolve(new Map<string, MeasureReading>()),
    readPluginLearnings(orgId, agentSlugs),
    readPluginActions(orgId, agentSlugs),
  ]);

  const view = planPluginPanel({
    pluginName: plugin.manifest.name,
    contents,
    teams,
    readings,
    agents: agentRows.map((a): PluginPanelAgent => ({ slug: a.slug, name: a.name, description: a.description })),
    learnings,
    actions,
  });

  return (
    <details className="group mb-6 border-b border-border/70 pb-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm">
        <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" aria-hidden />
        <span className="font-semibold">{view.title}</span>
        <span className="text-[13px] text-muted-foreground">
          {view.measures.length}
          {view.measures.length === 1 ? ' measure' : ' measures'}
          {' · '}
          {view.agents.length}
          {view.agents.length === 1 ? ' agent' : ' agents'}
          {' · '}
          {view.skills.length}
          {view.skills.length === 1 ? ' skill' : ' skills'}
        </span>
      </summary>

      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <Group heading="Measures" href="/dashboard/team-report">
          {view.measures.length === 0
            ? <Nothing>No measure declared — add one to this plugin's team to grade it.</Nothing>
            : view.measures.map(({ id, teamName, reading }) => <Reading key={id} teamName={teamName} reading={reading} />)}
        </Group>

        <Group heading="Agents">
          {view.agents.length === 0
            ? <Nothing>This plugin ships no agent.</Nothing>
            : view.agents.map(a => (
                <li key={a.slug} className="py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={a.profileHref} className="font-medium hover:underline">{a.name}</Link>
                    <Link href={a.chatHref} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Chat</Link>
                  </div>
                  {a.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{a.description}</p>}
                </li>
              ))}
        </Group>

        <Group heading="Skills & playbooks" href="/dashboard/skills">
          {view.skills.length === 0
            ? <Nothing>This plugin ships no skill.</Nothing>
            : view.skills.map(s => (
                <li key={`${s.hint}/${s.slug}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                  <Link href={s.href} className="font-medium hover:underline">{s.label}</Link>
                  <span className="font-mono text-[11px] text-muted-foreground">{s.hint}</span>
                </li>
              ))}
        </Group>

        <Group heading="Learned from use" href="/dashboard/learnings">
          {view.nothingLearned
            ? <Nothing>Nothing learned yet — corrections in chat and Review decisions land here.</Nothing>
            : (
                <>
                  {view.learnings.map((l) => {
                    const pill = learningPill(l.status);
                    return (
                      <li key={`learning-${l.id}`} className="py-2 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1">{l.text}</span>
                          <StatusPill status={pill.status} label={pill.label} size="sm" />
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{l.at ? l.at.toISOString().slice(0, 10) : 'no date'}</div>
                      </li>
                    );
                  })}
                  {view.actions.map((a) => {
                    const pill = actionPill(a.status);
                    return (
                      <li key={`action-${a.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                        <Link href="/dashboard/inbox" className="min-w-0 flex-1 truncate hover:underline">{a.title}</Link>
                        <StatusPill status={pill.status} label={pill.label} size="sm" />
                        <span className="text-[11px] text-muted-foreground">{a.at ? a.at.toISOString().slice(0, 10) : 'no date'}</span>
                      </li>
                    );
                  })}
                </>
              )}
        </Group>
      </div>
    </details>
  );
}

/**
 * One group of the panel: a small heading that is a door when there is a page
 * behind it, then hairline rows.
 * @param props
 * @param props.heading
 * @param props.href - The page this group's rows live on, when there is one.
 * @param props.children
 */
function Group({ heading, href, children }: { heading: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {href ? <Link href={href} className="hover:text-foreground">{heading}</Link> : heading}
      </h3>
      <ul className="divide-y divide-border/70">{children}</ul>
    </section>
  );
}

function Nothing({ children }: { children: React.ReactNode }) {
  return <li className="py-2 text-[13px] text-muted-foreground">{children}</li>;
}

/**
 * One measure reading, rendered the way the team report's dimension strip
 * renders a declared measure: the value in its unit, its target, the measure's
 * label and window, and the provenance chip — the same component, so a reading
 * cannot say more here than it says there.
 * @param props
 * @param props.teamName
 * @param props.reading
 */
function Reading({ teamName, reading }: { teamName: string; reading: MeasureReading }) {
  const m = reading.measure;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{m.label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {reading.value === null ? '—' : measureValue(reading.value, m.unit)}
          <span className="font-normal text-muted-foreground">
            {' · target '}
            {m.direction === 'lower' ? '≤' : '≥'}
            {measureValue(m.target, m.unit)}
          </span>
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {teamName}
          {' · '}
          {windowPhrase(m.window)}
        </span>
        <ProvenanceChip reading={reading} />
      </div>
    </li>
  );
}

/**
 * The plugin's learnings: candidates filed against a learning step one of its
 * agents owns, or scoped directly to one of its agents. Newest five.
 *
 * A step is a `memory_namespace` row carrying `agent_slugs`, so "whose step is
 * this" is answered by the same table the agent reads its rules from rather
 * than by a name convention.
 * @param orgId - Tenant.
 * @param agentSlugs - The plugin's agents.
 */
async function readPluginLearnings(orgId: string, agentSlugs: readonly string[]): Promise<PluginPanelLearning[]> {
  if (agentSlugs.length === 0) {
    return [];
  }
  const namespaces = await db
    .select({ name: memoryNamespaceSchema.name, agentSlugs: memoryNamespaceSchema.agentSlugs })
    .from(memoryNamespaceSchema)
    .where(eq(memoryNamespaceSchema.orgId, orgId));
  const steps = namespaces.filter(ns => ns.agentSlugs.some(s => agentSlugs.includes(s))).map(ns => ns.name);
  const scoped = and(eq(learningCandidateSchema.scopeKind, 'agent'), inArray(learningCandidateSchema.scopeRef, [...agentSlugs]));
  const where = steps.length > 0 ? or(inArray(learningCandidateSchema.stepName, steps), scoped) : scoped;
  const rows = await db
    .select({
      id: learningCandidateSchema.id,
      ruleText: learningCandidateSchema.ruleText,
      editedRuleText: learningCandidateSchema.editedRuleText,
      status: learningCandidateSchema.status,
      stepName: learningCandidateSchema.stepName,
      decidedAt: learningCandidateSchema.decidedAt,
      createdAt: learningCandidateSchema.createdAt,
    })
    .from(learningCandidateSchema)
    .where(and(eq(learningCandidateSchema.orgId, orgId), where))
    .orderBy(desc(learningCandidateSchema.createdAt))
    .limit(5);
  return rows.map(r => ({
    id: r.id,
    text: r.editedRuleText ?? r.ruleText,
    status: r.status,
    at: r.decidedAt ?? r.createdAt,
    step: r.stepName,
  }));
}

/** The statuses that mean a proposal has been decided, either way. */
const DECIDED_ACTION_STATUSES = ['done', 'rejected', 'undone'] as const;

/**
 * The plugin's decided proposals: action runs one of its agents proposed that
 * reached an end — executed, rejected or undone. Newest five, by when they
 * were decided.
 *
 * The agent behind a run is the same expression the team report reads
 * (`actionAgentSlug`), so "who proposed this" is answered once.
 * @param orgId - Tenant.
 * @param agentSlugs - The plugin's agents.
 */
async function readPluginActions(orgId: string, agentSlugs: readonly string[]): Promise<PluginPanelAction[]> {
  if (agentSlugs.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      input: actionRunSchema.input,
      status: actionRunSchema.status,
      decidedAt: actionRunSchema.decidedAt,
      executedAt: actionRunSchema.executedAt,
      createdAt: actionRunSchema.createdAt,
    })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      inArray(actionRunSchema.status, [...DECIDED_ACTION_STATUSES]),
      inArray(actionAgentSlug, [...agentSlugs]),
    ))
    .orderBy(sql`coalesce(${actionRunSchema.decidedAt}, ${actionRunSchema.executedAt}, ${actionRunSchema.createdAt}) desc`)
    .limit(5);
  return rows.map((r) => {
    const title = r.input?.title;
    return {
      id: r.id,
      title: typeof title === 'string' && title.length > 0 ? title : r.actionId,
      status: r.status,
      at: r.decidedAt ?? r.executedAt ?? r.createdAt,
    };
  });
}
