/**
 * The app fronts for one workspace — read when the Chat page renders, for
 * the app the person is in (`libs/chat/appFront.ts` is what a front holds and
 * why). Chat is shared by every app, so the page names the app from the
 * sidebar's cookie (`nav/workspaceMemory.ts`, `NAV_APP_COOKIE`): the core app
 * loads nothing, another app only its own front, and a browser that has not
 * said yet gets every installed app's, for the client to pick from.
 *
 * Every read is best-effort and none calls a model: a failed read leaves that
 * part out, never the page.
 */

import type { AppFront, AutomationRunInput, BriefingRowInput } from '@/libs/chat/appFront';
import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { appFromNavCookie } from '@/features/dashboard/nav/workspaceMemory';
import { installedApps } from '@/features/navigation/apps';
import { teamsOfApp } from '@/features/navigation/appTeams';
import { SURFACES } from '@/features/navigation/surfaces';
import { actionLabel } from '@/libs/actions/undoable';
import { attentionCounts, frontBriefing, pickAppBriefing } from '@/libs/chat/appFront';
import { db } from '@/libs/DB';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { agentSchema, automationRunSchema, briefingSchema, projectSchema, teamSchema } from '@/models/Schema';
import { parseStoredDocument } from '@/services/briefings/store';

/** How far back a brief may be and still lead the page; older, the page shows none. */
const BRIEF_WINDOW_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Plugin slug → the team slugs it ships. Plugins are core's own templates,
 * fixed for the life of the process, so they are read from disk once.
 */
let pluginTeamsCache: Record<string, string[]> | null = null;

export async function pluginTeams(): Promise<Record<string, string[]>> {
  if (pluginTeamsCache) {
    return pluginTeamsCache;
  }
  const { listPluginSlugs, loadPlugin, pluginContents } = await import('@/libs/workspace/plugins');
  const out: Record<string, string[]> = {};
  for (const slug of listPluginSlugs()) {
    try {
      out[slug] = pluginContents(loadPlugin(slug)).teams;
    } catch {
      out[slug] = [];
    }
  }
  pluginTeamsCache = out;
  return out;
}

/**
 * Where a person decides an action, when a surface on here decides it.
 * @param enabledSurfaces - The workspace's surfaces.
 * @param actionId - The action.
 */
function surfaceFor(enabledSurfaces: readonly string[], actionId: string): string | null {
  for (const id of enabledSurfaces) {
    const surface = (SURFACES as Record<string, { url: string; decides?: readonly string[] }>)[id];
    if (surface?.decides?.includes(actionId)) {
      return surface.url;
    }
  }
  return null;
}

/**
 * The run that wrote a brief and its automation's runs since: the automation
 * run that dispatched the brief's mission run, then only that automation's
 * later runs. Nothing when the brief names no mission run.
 * @param orgId - The workspace.
 * @param brief - The brief.
 */
async function writerRuns(orgId: string, brief: BriefingRowInput): Promise<AutomationRunInput[]> {
  if (brief.missionRunId === null) {
    return [];
  }
  const cols = { id: automationRunSchema.id, slug: automationRunSchema.slug, kind: automationRunSchema.kind, status: automationRunSchema.status, startedAt: automationRunSchema.startedAt, finishedAt: automationRunSchema.finishedAt, targetRunId: automationRunSchema.targetRunId };
  const [writer] = await db.select(cols).from(automationRunSchema).where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.kind, 'mission_check'), eq(automationRunSchema.targetRunId, brief.missionRunId))).limit(1);
  if (!writer) {
    return [];
  }
  const later = await db.select(cols).from(automationRunSchema).where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.slug, writer.slug), gt(automationRunSchema.startedAt, brief.createdAt))).orderBy(desc(automationRunSchema.startedAt)).limit(1);
  return [writer, ...later];
}

/**
 * The fronts to draw in this workspace, keyed by app id. An app with no
 * team, or with nothing to say, is left out.
 * @param orgId - The workspace.
 * @param opts - Which app the person is in, when the browser has said.
 * @param opts.navCookie - The `NAV_APP_COOKIE` value; it counts only when it names this workspace.
 * @param opts.appId
 * @param opts.now - Now (tests).
 */
export async function loadAppFronts(orgId: string, opts: { navCookie?: string | null; appId?: string | null; now?: Date } = {}): Promise<Record<string, AppFront>> {
  const now = opts.now ?? new Date();
  const [{ safeListApps }, project] = await Promise.all([
    import('@/libs/workspace/apps'),
    db.select({ slug: projectSchema.slug, plugins: projectSchema.enabledPlugins, surfaces: projectSchema.enabledSurfaces }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1).then(r => r[0] ?? null),
  ]);
  if (!project) {
    return {};
  }
  const catalogue = safeListApps();
  const installed = installedApps(project.plugins ?? [], project.surfaces ?? [], catalogue);
  // The app the browser named: the core app has no front; another loads alone.
  const app = opts.appId ?? appFromNavCookie(opts.navCookie, project.slug);
  const named = app ? installed.find(a => a.id === app) : undefined;
  if (named?.core) {
    return {};
  }
  const apps = named ? [named] : installed.filter(a => !a.core);
  if (apps.length === 0) {
    return {};
  }

  const [teams, agents, shipped] = await Promise.all([
    db.select({ slug: teamSchema.slug, app: teamSchema.app, lead: teamSchema.leadAgentSlug }).from(teamSchema).where(eq(teamSchema.orgId, orgId)),
    db.select({ slug: agentSchema.slug, team: agentSchema.teamSlug }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), isNotNull(agentSchema.teamSlug))),
    pluginTeams(),
  ]);
  const scopes = apps
    .map((app) => {
      const appTeams = teamsOfApp(app.id, teams, { apps: catalogue, pluginTeams: shipped });
      return { app, teams: appTeams, agents: agents.filter(a => a.team && appTeams.includes(a.team)).map(a => a.slug) };
    })
    .filter(s => s.teams.length > 0);
  if (scopes.length === 0) {
    return {};
  }

  const allTeams = scopes.flatMap(s => s.teams);
  const [timeZone, briefs, waiting] = await Promise.all([
    workspaceTimeZone(orgId),
    // The newest brief per team, so one busy team never crowds out another's.
    db.selectDistinctOn([briefingSchema.teamSlug], { id: briefingSchema.id, title: briefingSchema.title, createdAt: briefingSchema.createdAt, teamSlug: briefingSchema.teamSlug, document: briefingSchema.document, missionRunId: briefingSchema.missionRunId })
      .from(briefingSchema)
      .where(and(eq(briefingSchema.orgId, orgId), inArray(briefingSchema.teamSlug, allTeams), gt(briefingSchema.createdAt, new Date(now.getTime() - BRIEF_WINDOW_DAYS * DAY))))
      .orderBy(briefingSchema.teamSlug, desc(briefingSchema.createdAt))
      .catch(() => []),
    import('@/services/InboxService').then(m => m.needsYouItems(orgId)).catch(() => []),
  ]);

  const fronts = await Promise.all(scopes.map(async (scope): Promise<AppFront | null> => {
    const row = pickAppBriefing(briefs, scope.teams);
    const briefRow: BriefingRowInput | null = row ? { ...row, document: parseStoredDocument(row.document) } : null;
    const runs = briefRow ? await writerRuns(orgId, briefRow).catch(() => []) : [];
    const briefing = briefRow ? frontBriefing(briefRow, { now, timeZone, runs }) : null;
    const { counts, more, outside } = attentionCounts(waiting, scope.agents, { label: actionLabel, surfaceFor: id => surfaceFor(project.surfaces ?? [], id) });
    if (!briefing && counts.length === 0 && !more) {
      return null;
    }
    // The lead of the team whose brief this is; else the first of the app's teams with one.
    const leadTeam = teams.find(t => t.slug === row?.teamSlug && t.lead) ?? teams.find(t => scope.teams.includes(t.slug) && t.lead);
    return { appId: scope.app.id, appName: scope.app.shortName ?? scope.app.name, leadSlug: leadTeam?.lead ?? null, counts, more, outside, briefing };
  }));
  return Object.fromEntries(fronts.filter((f): f is AppFront => f !== null).map(f => [f.appId, f]));
}
