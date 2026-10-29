/**
 * The app fronts for one workspace — read once when the Chat page renders,
 * one per installed app other than the core one (`libs/chat/appFront.ts` is
 * what each holds and why). Which app the page is in is the browser's to say
 * (the sidebar remembers it per workspace), so the page is handed every app's
 * front and draws the one it is in.
 *
 * Every read is best-effort and none calls a model: a failed read leaves that
 * part out, never the page.
 */

import type { AppFront, AutomationRunInput, BriefingRowInput } from '@/libs/chat/appFront';
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { installedApps } from '@/features/navigation/apps';
import { teamsOfApp } from '@/features/navigation/appTeams';
import { SURFACES } from '@/features/navigation/surfaces';
import { actionLabel } from '@/libs/actions/undoable';
import { attentionCounts, attentionPrompt, frontBriefing, pickAppBriefing } from '@/libs/chat/appFront';
import { db } from '@/libs/DB';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { agentSchema, automationRunSchema, briefingSchema, projectSchema, teamSchema } from '@/models/Schema';
import { parseStoredDocument } from '@/services/briefings/store';

/** How far back a brief may be and still lead the page; older, the page shows none. */
const BRIEF_WINDOW_DAYS = 14;

/** How long before a brief the run that wrote it may have started. */
const RUN_LEAD_MS = 6 * 60 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

/**
 * The team slugs each shipped plugin ships, for the plugins named.
 * @param plugins - Plugin slugs.
 */
async function pluginTeamsOf(plugins: readonly string[]): Promise<Record<string, string[]>> {
  const { loadPlugin, pluginContents } = await import('@/libs/workspace/plugins');
  const out: Record<string, string[]> = {};
  for (const slug of new Set(plugins)) {
    try {
      out[slug] = pluginContents(loadPlugin(slug)).teams;
    } catch {
      out[slug] = [];
    }
  }
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
 * Every non-core app's front in this workspace, keyed by app id. An app with
 * no team, or with nothing to say, is left out.
 * @param orgId - The workspace.
 * @param now - Now (tests).
 */
export async function loadAppFronts(orgId: string, now: Date = new Date()): Promise<Record<string, AppFront>> {
  const [{ safeListApps }, project] = await Promise.all([
    import('@/libs/workspace/apps'),
    db.select({ plugins: projectSchema.enabledPlugins, surfaces: projectSchema.enabledSurfaces }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1).then(r => r[0] ?? null),
  ]);
  if (!project) {
    return {};
  }
  const catalogue = safeListApps();
  const apps = installedApps(project.plugins ?? [], project.surfaces ?? [], catalogue).filter(a => !a.core);
  if (apps.length === 0) {
    return {};
  }

  const [teams, agents, pluginTeams] = await Promise.all([
    db.select({ slug: teamSchema.slug, app: teamSchema.app, lead: teamSchema.leadAgentSlug }).from(teamSchema).where(eq(teamSchema.orgId, orgId)),
    db.select({ slug: agentSchema.slug, team: agentSchema.teamSlug }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), isNotNull(agentSchema.teamSlug))),
    pluginTeamsOf(catalogue.flatMap(a => a.plugins)),
  ]);
  const scopes = apps
    .map((app) => {
      const appTeams = teamsOfApp(app.id, teams, { apps: catalogue, pluginTeams });
      return { app, teams: appTeams, agents: agents.filter(a => a.team && appTeams.includes(a.team)).map(a => a.slug) };
    })
    .filter(s => s.teams.length > 0);
  if (scopes.length === 0) {
    return {};
  }

  const allTeams = scopes.flatMap(s => s.teams);
  const [timeZone, briefs, waiting] = await Promise.all([
    workspaceTimeZone(orgId),
    db.select({ id: briefingSchema.id, title: briefingSchema.title, createdAt: briefingSchema.createdAt, teamSlug: briefingSchema.teamSlug, document: briefingSchema.document })
      .from(briefingSchema)
      .where(and(eq(briefingSchema.orgId, orgId), inArray(briefingSchema.teamSlug, allTeams), gte(briefingSchema.createdAt, new Date(now.getTime() - BRIEF_WINDOW_DAYS * DAY))))
      .orderBy(desc(briefingSchema.createdAt))
      .limit(50)
      .catch(() => []),
    import('@/services/InboxService').then(m => m.needsYouItems(orgId)).catch(() => []),
  ]);

  const out: Record<string, AppFront> = {};
  for (const scope of scopes) {
    const row = pickAppBriefing(briefs, scope.teams);
    const briefRow: BriefingRowInput | null = row ? { ...row, document: parseStoredDocument(row.document) } : null;
    const runs: AutomationRunInput[] = briefRow
      ? await db.select({ id: automationRunSchema.id, slug: automationRunSchema.slug, kind: automationRunSchema.kind, status: automationRunSchema.status, startedAt: automationRunSchema.startedAt, finishedAt: automationRunSchema.finishedAt, targetRunId: automationRunSchema.targetRunId })
          .from(automationRunSchema)
          .where(and(eq(automationRunSchema.orgId, orgId), gte(automationRunSchema.startedAt, new Date(briefRow.createdAt.getTime() - RUN_LEAD_MS))))
          .orderBy(desc(automationRunSchema.startedAt))
          .limit(500)
          .catch(() => [])
      : [];
    const briefing = briefRow ? frontBriefing(briefRow, { now, timeZone, runs }) : null;
    const { counts, more } = attentionCounts(waiting, scope, { label: actionLabel, surfaceFor: id => surfaceFor(project.surfaces ?? [], id) });
    if (!briefing && counts.length === 0 && !more) {
      continue;
    }
    // The lead of the team whose brief this is; else the first of the app's teams with one.
    const leadTeam = teams.find(t => t.slug === row?.teamSlug && t.lead) ?? teams.find(t => scope.teams.includes(t.slug) && t.lead);
    out[scope.app.id] = { appId: scope.app.id, leadSlug: leadTeam?.lead ?? null, prompt: attentionPrompt(briefing), counts, more, briefing };
  }
  return out;
}
