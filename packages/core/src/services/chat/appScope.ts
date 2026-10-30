/**
 * THE APP A CHAT TURN IS SAID IN, as routing reads it.
 *
 * Chat is shared by every app, so the sidebar's cookie names which app the
 * person is in (`nav/workspaceMemory.ts`, `NAV_APP_COOKIE`), the same signal
 * the Chat page reads to draw that app's front (`appFront.ts`). In an app's
 * chat the router chooses among the app's own teams and its lead, and the
 * workspace's lead outside the app is a candidate only for work clearly
 * outside every app (`services/agents/router.ts`, `appRoster`).
 *
 * 2026-10-29: in an SEO app's chat, "connect to Github for our projects" went
 * to the workspace's generic lead as "workspace setup", and the thread stayed
 * there while the generic lead planned the SEO team's pages itself.
 *
 * No model call. A failed read is no app: the whole roster routes, as before.
 */

import type { AppDefinition } from '@/features/navigation/apps';
import type { TeamAppInput } from '@/features/navigation/appTeams';
import type { AppScope } from '@/services/agents/router';
import { eq } from 'drizzle-orm';
import { appFromNavCookie, NAV_APP_COOKIE } from '@/features/dashboard/nav/workspaceMemory';
import { installedApps } from '@/features/navigation/apps';
import { teamsOfApp } from '@/features/navigation/appTeams';
import { appFromReferer } from '@/libs/appLinks';
import { WORKSPACE_LEAD_SLUG } from '@/libs/workspace/workspaceLead';
import { loadOwnedPageApp } from '@/services/chat/ownedPageApp';

/** A team as routing needs it: its slug, the app its file names, its lead. */
export type RoutingTeam = TeamAppInput & { lead: string | null };

/** An agent as this needs it. */
type AgentLite = { slug: string; active?: string | boolean | null; teamSlug?: string | null };

const isOn = (a: AgentLite | undefined): boolean => Boolean(a) && (a!.active === undefined || a!.active === null || a!.active === true || a!.active === 'true');

/**
 * The app scope for one turn, from what the workspace has. Pure.
 *
 * The app's lead is the workspace's lead when that agent leads one of the
 * app's teams (an app installed into an empty workspace adopts its lead),
 * else the first of the app's teams with an active lead. The workspace's lead
 * outside the app is `project.lead_agent_slug` when it is not one of the
 * app's seats, else the seeded lead core makes for every workspace.
 * @param input - What the workspace has.
 * @param input.appId - The app the cookie names, if any.
 * @param input.apps - The app catalogue.
 * @param input.enabledPlugins - `project.enabled_plugins`.
 * @param input.enabledSurfaces - `project.enabled_surfaces`.
 * @param input.teams - The workspace's teams, in their order.
 * @param input.pluginTeams - Plugin slug → the team slugs it ships.
 * @param input.projectLead - `project.lead_agent_slug`.
 * @param input.agents - The roster.
 */
export function resolveAppScope(input: {
  appId: string | null;
  apps: readonly AppDefinition[];
  enabledPlugins: readonly string[];
  enabledSurfaces: readonly string[];
  teams: readonly RoutingTeam[];
  pluginTeams: Readonly<Record<string, readonly string[]>>;
  projectLead: string | null;
  agents: readonly AgentLite[];
}): AppScope | null {
  if (!input.appId) {
    return null;
  }
  const app = installedApps(input.enabledPlugins, input.enabledSurfaces, input.apps).find(a => a.id === input.appId);
  if (!app || app.core) {
    return null;
  }
  const teams = teamsOfApp(app.id, input.teams, { apps: input.apps, pluginTeams: input.pluginTeams });
  if (teams.length === 0) {
    return null;
  }
  const bySlug = new Map(input.agents.map(a => [a.slug, a]));
  const leads = input.teams.filter(t => teams.includes(t.slug) && t.lead && isOn(bySlug.get(t.lead))).map(t => t.lead!);
  const leadSlug = input.projectLead && leads.includes(input.projectLead) ? input.projectLead : leads[0];
  if (!leadSlug) {
    return null;
  }
  const inApp = (slug: string) => leads.includes(slug) || teams.includes(bySlug.get(slug)?.teamSlug ?? '');
  const outside = [input.projectLead, WORKSPACE_LEAD_SLUG].find((s): s is string => !!s && isOn(bySlug.get(s)) && !inApp(s)) ?? null;
  return { id: app.id, name: app.shortName ?? app.name, teams, leadSlug, outsideSlug: outside };
}

/**
 * One cookie's value from a `Cookie` header.
 * @param header - The request's `Cookie` header.
 * @param name - The cookie.
 */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      return part.slice(at + 1).trim() || null;
    }
  }
  return null;
}

/**
 * The workspace's teams (for who leads what) and the app the turn is said in.
 * @param orgId - The workspace.
 * @param opts - The request and the roster already read.
 * @param opts.cookie - The request's `Cookie` header.
 * @param opts.referer
 * @param opts.agents - The roster.
 */
export async function loadRoutingContext(orgId: string, opts: { cookie: string | null; referer?: string | null; agents: readonly AgentLite[] }): Promise<{ teams: RoutingTeam[]; app: AppScope | null }> {
  try {
    const [{ db }, { projectSchema, teamSchema }, { safeListApps }, { pluginTeams }] = await Promise.all([
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('@/libs/workspace/apps'),
      import('@/services/chat/appFront'),
    ]);
    const [project, teams] = await Promise.all([
      db.select({ slug: projectSchema.slug, plugins: projectSchema.enabledPlugins, surfaces: projectSchema.enabledSurfaces, lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1).then(r => r[0] ?? null),
      db.select({ slug: teamSchema.slug, app: teamSchema.app, lead: teamSchema.leadAgentSlug }).from(teamSchema).where(eq(teamSchema.orgId, orgId)).orderBy(teamSchema.id),
    ]);
    if (!project) {
      return { teams, app: null };
    }
    const appId = appFromReferer(opts.referer, project.slug) ?? await loadOwnedPageApp({ orgId, workspaceSlug: project.slug, referer: opts.referer, enabledPlugins: project.plugins ?? [], enabledSurfaces: project.surfaces ?? [] }) ?? appFromNavCookie(cookieValue(opts.cookie, NAV_APP_COOKIE), project.slug);
    const app = appId
      ? resolveAppScope({ appId, apps: safeListApps(), enabledPlugins: project.plugins ?? [], enabledSurfaces: project.surfaces ?? [], teams, pluginTeams: await pluginTeams(), projectLead: project.lead, agents: opts.agents })
      : null;
    return { teams, app };
  } catch (error) {
    console.warn('chat: could not read the app the turn is in; the whole roster routes', { orgId, error: error instanceof Error ? error.message : String(error) });
    return { teams: [], app: null };
  }
}
