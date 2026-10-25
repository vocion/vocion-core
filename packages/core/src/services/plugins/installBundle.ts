/**
 * TURNING AN APP ON IN A WORKSPACE WITH NO FOLDER SETS THE WHOLE APP UP.
 *
 * A workspace made in the app (every Vocion Cloud workspace) has no
 * `workspace.yaml`. Until now, turning an app on there only flipped
 * `project.enabled_plugins`: the app's pages appeared, but its agents,
 * missions, automations, teams, skills and trust rules — which only a
 * workspace apply writes — never did. A Cloud client who added Marketing got
 * the Campaigns page and no Marketing lead, no daily update, no guard.
 *
 * So for such a workspace the plugins being turned on are applied through the
 * same applier a workspace apply uses, in its additive mode
 * (`ApplyOptions.additive`): the bundle is upserted and nothing else in the
 * workspace is touched. The bundle is read through the loader from a
 * throwaway manifest (`plugins:` plus the project's time zone, so a schedule
 * reads `timezone: workspace` as the workspace's clock), never hand-built.
 *
 * Turning one off disables what it set up — missions and automations to
 * `disabled` (their schedules removed), its agents inactive — and keeps every
 * row, so history stays and turning it back on restores the same rows.
 *
 * A workspace applied from a folder (a self-hosted deployment's repo, like
 * Metacto's) is never set up this way: its manifest is the source of truth,
 * and the next deploy would retire whatever this wrote. {@link appliedFromFolder}
 * tells the two apart by the applier's own record.
 */

import type { ApplyResult } from '@/libs/workspace/applier';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray, isNull, notLike, or } from 'drizzle-orm';
import { stringify } from 'yaml';
import { db } from '@/libs/DB';
import { applyWorkspace, loadWorkspace } from '@/libs/workspace';
import { loadPlugin, pluginContents, resolvePlugins } from '@/libs/workspace/plugins';
import { WORKSPACE_LEAD_SLUG } from '@/libs/workspace/workspaceLead';
import { agentSchema, automationSchema, missionSchema, projectSchema, workspaceVersionSchema } from '@/models/Schema';

/** How an install is recorded in `workspace_version.source_path`: never a folder. */
export const APP_INSTALL_SOURCE_PREFIX = 'app:';

/**
 * Whether this workspace has ever been applied from a folder — a
 * `workspace_version` row whose source is not an app install. Such a
 * workspace's manifest owns what it has; an app turned on there is the
 * repo's business (`PluginService` says so and names the file).
 * @param orgId - The project.
 */
export async function appliedFromFolder(orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaceVersionSchema.id })
    .from(workspaceVersionSchema)
    .where(and(
      eq(workspaceVersionSchema.orgId, orgId),
      or(isNull(workspaceVersionSchema.sourcePath), notLike(workspaceVersionSchema.sourcePath, `${APP_INSTALL_SOURCE_PREFIX}%`)),
    ))
    .limit(1);
  return Boolean(row);
}

export type BundleInstall = {
  /** The plugins whose bundles were applied, dependencies first. */
  plugins: string[];
  counts: ApplyResult['counts'];
  errors: ApplyResult['errors'];
  /** The agent that became the workspace lead, when one did. */
  leadAdopted: string | null;
  /** Who became accountable (the installing admin), when the workspace had no one. */
  accountableSet: string | null;
};

/**
 * The manifest an install is read through: the plugins, and the project's
 * name and time zone. Pure, so the shape is tested without a database.
 * @param project - The project's row.
 * @param project.orgId
 * @param project.name
 * @param project.timeZone
 * @param plugins - Dependency-closed, in load order.
 */
export function installManifest(project: { orgId: string; name: string; timeZone: string | null }, plugins: readonly string[]): Record<string, unknown> {
  return {
    version: 2,
    orgId: project.orgId,
    name: project.name,
    plugins: [...plugins],
    ...(project.timeZone ? { defaults: { timezone: project.timeZone } } : {}),
  };
}

/**
 * Which agent should lead after an install: the first installed plugin that
 * names a `lead:`, but only when the workspace has no lead or only the
 * generic one core seeds. A lead a person chose is never replaced.
 * @param current - `project.lead_agent_slug` now.
 * @param plugins - The installed plugins, in the order they were asked for.
 */
export function leadToAdopt(current: string | null, plugins: ReadonlyArray<{ lead?: string }>): string | null {
  if (current && current !== WORKSPACE_LEAD_SLUG) {
    return null;
  }
  return plugins.find(p => p.lead)?.lead ?? null;
}

/**
 * Set up what these plugins ship in a workspace with no folder: agents,
 * missions, automations (in the workspace's time zone), teams, skills,
 * playbooks, object types, trust rules, notification kinds and sources —
 * through the applier, additively. Idempotent: a second install updates
 * nothing it does not need to.
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.plugins - The plugins turned on (dependencies are added).
 * @param opts.appliedBy - Who turned them on, for the version row.
 */
export async function installPluginBundles(opts: { orgId: string; plugins: readonly string[]; appliedBy: string }): Promise<BundleInstall> {
  const resolved = resolvePlugins([...new Set(opts.plugins)]);
  const slugs = resolved.map(p => p.manifest.slug);
  const [project] = await db
    .select({ name: projectSchema.name, timeZone: projectSchema.timeZone, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, opts.orgId))
    .limit(1);
  if (!project) {
    throw new Error(`no project ${opts.orgId}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'vocion-app-install-'));
  let result: ApplyResult;
  try {
    writeFileSync(join(dir, 'workspace.yaml'), stringify(installManifest({ orgId: opts.orgId, name: project.name, timeZone: project.timeZone ?? null }, slugs)), 'utf8');
    const loaded = loadWorkspace(dir);
    result = await applyWorkspace({ ...loaded, sourcePath: `${APP_INSTALL_SOURCE_PREFIX}${slugs.join(',')}` }, { orgId: opts.orgId, appliedBy: opts.appliedBy, additive: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The asked-for plugins in the order asked, so the app's own lead wins over a dependency's.
  const asked = opts.plugins.map(slug => resolved.find(p => p.manifest.slug === slug)?.manifest).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const candidate = leadToAdopt(project.leadAgentSlug ?? null, asked);
  let leadAdopted: string | null = null;
  if (candidate) {
    const [agent] = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, candidate), eq(agentSchema.active, 'true'))).limit(1);
    if (agent) {
      await db.update(projectSchema).set({ leadAgentSlug: candidate }).where(eq(projectSchema.id, opts.orgId));
      leadAdopted = candidate;
    }
  }
  // An app that mails its updates needs someone to mail them to: a workspace
  // with no accountable person gets the admin who installed the app.
  const { defaultAccountable } = await import('@/services/workspace/accountable');
  const accountableSet = await defaultAccountable(opts.orgId, opts.appliedBy).catch(() => null);
  await flushRuntime();
  return { plugins: slugs, counts: result.counts, errors: result.errors, leadAdopted, accountableSet };
}

/**
 * Turn off what these plugins set up, keeping every row: missions and
 * automations disabled (schedules removed), agents inactive. A plugin still
 * needed by one that stays on is left alone. If the workspace was led by one
 * of the agents going away, the generic lead takes over again when it exists.
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.plugins - The plugins turned off.
 * @param opts.stillOn - The plugins that stay on (dependency-closed).
 */
export async function retirePluginBundles(opts: { orgId: string; plugins: readonly string[]; stillOn: readonly string[] }): Promise<{ missions: number; automations: number; agents: number; leadRestored: string | null }> {
  const keep = new Set(opts.stillOn);
  const going = opts.plugins.filter(s => !keep.has(s));
  const names = { agents: [] as string[], missions: [] as string[], automations: [] as string[] };
  for (const slug of going) {
    const contents = pluginContents(loadPlugin(slug));
    names.agents.push(...contents.agents);
    names.missions.push(...contents.missions);
    names.automations.push(...contents.automations);
  }
  if (going.length === 0) {
    return { missions: 0, automations: 0, agents: 0, leadRestored: null };
  }
  const missions = names.missions.length === 0
    ? []
    : await db.update(missionSchema).set({ status: 'disabled', updatedAt: new Date() }).where(and(eq(missionSchema.orgId, opts.orgId), inArray(missionSchema.slug, names.missions))).returning({ slug: missionSchema.slug });
  const automations = names.automations.length === 0
    ? []
    : await db.update(automationSchema).set({ status: 'disabled', updatedAt: new Date() }).where(and(eq(automationSchema.orgId, opts.orgId), inArray(automationSchema.slug, names.automations))).returning({ slug: automationSchema.slug });
  const agents = names.agents.length === 0
    ? []
    : await db.update(agentSchema).set({ active: 'false' }).where(and(eq(agentSchema.orgId, opts.orgId), inArray(agentSchema.slug, names.agents))).returning({ slug: agentSchema.slug });

  // Only the scheduler-of-record writes schedules (see the applier's
  // reconcileSchedules); a disabled automation is not run either way.
  if (process.env.VOCION_SCHEDULE_OWNER === '1' && automations.length > 0) {
    const { removeAutomationSchedule } = await import('@/services/AutomationService');
    for (const row of automations) {
      await removeAutomationSchedule(opts.orgId, row.slug).catch(() => {});
    }
  }

  let leadRestored: string | null = null;
  const [project] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, opts.orgId)).limit(1);
  if (project?.lead && names.agents.includes(project.lead)) {
    const [seeded] = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, WORKSPACE_LEAD_SLUG))).limit(1);
    if (seeded) {
      await db.update(agentSchema).set({ active: 'true' }).where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, WORKSPACE_LEAD_SLUG), isNull(agentSchema.pausedAt)));
      leadRestored = WORKSPACE_LEAD_SLUG;
    }
    await db.update(projectSchema).set({ leadAgentSlug: seeded ? WORKSPACE_LEAD_SLUG : null }).where(eq(projectSchema.id, opts.orgId));
  }
  await flushRuntime();
  return { missions: missions.length, automations: automations.length, agents: agents.length, leadRestored };
}

/** Compiled chat graphs bake in the roster; a changed one must not be served stale. */
async function flushRuntime(): Promise<void> {
  try {
    const { resetAgentRuntimeCache } = await import('@/services/agents/harness');
    resetAgentRuntimeCache();
  } catch { /* the rows are written; a stale cache is not worth failing over */ }
}
