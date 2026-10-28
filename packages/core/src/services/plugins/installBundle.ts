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
 *
 * When core ships new templates for an app that is on, the next boot applies
 * them the same way, keeping what a person changed since
 * (`services/plugins/upgradeBundles.ts`). Each install and upgrade records on
 * its version row what it wrote (`workspace_version.bundle`) so that one can
 * tell the two apart.
 */

import type { ApplyResult } from '@/libs/workspace/applier';
import type { AppBundleRecord, BundleFields, BundleTrack, TrackedResource } from '@/libs/workspace/bundleTrack';
import type { LoadedPlugin } from '@/libs/workspace/plugins';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { and, asc, eq, inArray, isNull, like, notLike, or } from 'drizzle-orm';
import { stringify } from 'yaml';
import { db } from '@/libs/DB';
import { applyWorkspace, loadWorkspace } from '@/libs/workspace';
import { fieldsAfter, mergeFields } from '@/libs/workspace/bundleTrack';
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
  const [project] = await db
    .select({ name: projectSchema.name, timeZone: projectSchema.timeZone, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, opts.orgId))
    .limit(1);
  if (!project) {
    throw new Error(`no project ${opts.orgId}`);
  }
  const { resolved, slugs, result, record } = await applyAppBundles({ orgId: opts.orgId, plugins: opts.plugins, appliedBy: opts.appliedBy, project, history: await appHistory(opts.orgId) });
  await recordBundle(result.versionId, record);

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
  const out = await disableBundleItems(opts.orgId, names);
  await flushRuntime();
  return out;
}

/**
 * Disable what a bundle set up, by name, keeping every row: missions and
 * automations to `disabled` (schedules removed), agents inactive. When the
 * workspace was led by one of those agents, the generic lead leads again.
 * What turning an app off does, and what an upgrade does with what the new
 * templates dropped.
 * @param orgId - The project.
 * @param names - The rows, per kind.
 * @param names.agents
 * @param names.missions
 * @param names.automations
 */
export async function disableBundleItems(orgId: string, names: { agents: readonly string[]; missions: readonly string[]; automations: readonly string[] }): Promise<{ missions: number; automations: number; agents: number; leadRestored: string | null }> {
  const missions = names.missions.length === 0
    ? []
    : await db.update(missionSchema).set({ status: 'disabled', updatedAt: new Date() }).where(and(eq(missionSchema.orgId, orgId), inArray(missionSchema.slug, [...names.missions]))).returning({ slug: missionSchema.slug });
  const automations = names.automations.length === 0
    ? []
    : await db.update(automationSchema).set({ status: 'disabled', updatedAt: new Date() }).where(and(eq(automationSchema.orgId, orgId), inArray(automationSchema.slug, [...names.automations]))).returning({ slug: automationSchema.slug });
  const agents = names.agents.length === 0
    ? []
    : await db.update(agentSchema).set({ active: 'false' }).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, [...names.agents]))).returning({ slug: agentSchema.slug });

  // Only the scheduler-of-record writes schedules (see the applier's
  // reconcileSchedules); a disabled automation is not run either way.
  if (process.env.VOCION_SCHEDULE_OWNER === '1' && automations.length > 0) {
    const { removeAutomationSchedule } = await import('@/services/AutomationService');
    for (const row of automations) {
      await removeAutomationSchedule(orgId, row.slug).catch(() => {});
    }
  }

  let leadRestored: string | null = null;
  const [project] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (project?.lead && names.agents.includes(project.lead)) {
    const [seeded] = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, WORKSPACE_LEAD_SLUG))).limit(1);
    if (seeded) {
      await db.update(agentSchema).set({ active: 'true' }).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, WORKSPACE_LEAD_SLUG), isNull(agentSchema.pausedAt)));
      leadRestored = WORKSPACE_LEAD_SLUG;
    }
    await db.update(projectSchema).set({ leadAgentSlug: seeded ? WORKSPACE_LEAD_SLUG : null }).where(eq(projectSchema.id, orgId));
  }
  return { missions: missions.length, automations: automations.length, agents: agents.length, leadRestored };
}

/** What a workspace's app version rows say, folded oldest first. */
export type AppHistory = {
  /** Every plugin an app install or upgrade set up here. */
  installed: string[];
  /** Per plugin, the template hash of the last install or upgrade that applied cleanly. */
  hashes: Record<string, string>;
  /** Per plugin, what its templates shipped when last recorded. */
  contents: AppBundleRecord['contents'];
  /** What the bundles last left in each field they own. */
  fields: BundleFields;
};

/**
 * Read a workspace's app installs and upgrades (`workspace_version` rows whose
 * source is `app:…`). Rows from before the `bundle` record existed name their
 * plugins and nothing else.
 * @param orgId - The project.
 */
export async function appHistory(orgId: string): Promise<AppHistory> {
  const rows = await db
    .select({ sourcePath: workspaceVersionSchema.sourcePath, status: workspaceVersionSchema.status, bundle: workspaceVersionSchema.bundle })
    .from(workspaceVersionSchema)
    .where(and(eq(workspaceVersionSchema.orgId, orgId), like(workspaceVersionSchema.sourcePath, `${APP_INSTALL_SOURCE_PREFIX}%`)))
    .orderBy(asc(workspaceVersionSchema.appliedAt), asc(workspaceVersionSchema.id));
  const installed = new Set<string>();
  const hashes: AppHistory['hashes'] = {};
  const contents: AppHistory['contents'] = {};
  for (const row of rows) {
    for (const slug of (row.sourcePath ?? '').slice(APP_INSTALL_SOURCE_PREFIX.length).split(',').filter(Boolean)) {
      installed.add(slug);
    }
    // A partial apply is tried again on the next pass, so its hashes do not count as reached.
    if (row.bundle && row.status === 'applied') {
      Object.assign(hashes, row.bundle.hashes);
    }
    Object.assign(contents, row.bundle?.contents ?? {});
  }
  return { installed: [...installed], hashes, contents, fields: mergeFields(rows.flatMap(r => (r.bundle ? [r.bundle] : []))) };
}

/**
 * A hash of everything one plugin ships, read from its directory in this
 * image: what changes when core ships new templates for it.
 * @param plugin - A loaded plugin.
 */
export function pluginTemplateHash(plugin: LoadedPlugin): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      hash.update(relative(plugin.sourcePath, path)).update('\0').update(readFileSync(path)).update('\0');
    }
  };
  walk(plugin.sourcePath);
  return hash.digest('hex').slice(0, 16);
}

/**
 * Apply these plugins' bundles (dependencies added) to a workspace with no
 * folder, additively, keeping every field a person changed since the bundle
 * last wrote it (`libs/workspace/bundleTrack.ts`). Returns what to record on
 * the version row; {@link recordBundle} writes it.
 * @param opts
 * @param opts.orgId - The project.
 * @param opts.plugins - The plugins to apply.
 * @param opts.appliedBy - Who, for the version row.
 * @param opts.project - The project's name and time zone.
 * @param opts.project.name
 * @param opts.project.timeZone
 * @param opts.history - The workspace's app history ({@link appHistory}).
 */
export async function applyAppBundles(opts: { orgId: string; plugins: readonly string[]; appliedBy: string; project: { name: string; timeZone: string | null }; history: AppHistory }): Promise<{ resolved: LoadedPlugin[]; slugs: string[]; result: ApplyResult; record: AppBundleRecord }> {
  const resolved = resolvePlugins([...new Set(opts.plugins)]);
  const slugs = resolved.map(p => p.manifest.slug);
  const hashes = Object.fromEntries(resolved.map(p => [p.manifest.slug, pluginTemplateHash(p)]));
  const track: BundleTrack = { last: opts.history.fields, kept: [], wrote: {} };
  const dir = mkdtempSync(join(tmpdir(), 'vocion-app-install-'));
  let result: ApplyResult;
  let contents: AppBundleRecord['contents'];
  try {
    writeFileSync(join(dir, 'workspace.yaml'), stringify(installManifest({ orgId: opts.orgId, name: opts.project.name, timeZone: opts.project.timeZone ?? null }, slugs)), 'utf8');
    const loaded = loadWorkspace(dir);
    // What each plugin shipped, as loaded: a mission's schedule is an automation
    // by now, and it carries the mission's file, so it is counted with its plugin.
    const of = (p: LoadedPlugin) => (r: { sourceFile: string; slug: string }) => r.sourceFile.startsWith(`${p.sourcePath}${sep}`);
    contents = Object.fromEntries(resolved.map(p => [p.manifest.slug, {
      agents: loaded.agents.filter(of(p)).map(a => a.slug),
      missions: loaded.missions.filter(of(p)).map(m => m.slug),
      automations: loaded.automations.filter(of(p)).map(a => a.slug),
    }]));
    // The sha names the templates, not the throwaway folder they were read through.
    const combined = createHash('sha256').update(slugs.map(s => `${s}:${hashes[s]}`).join('\n')).digest('hex').slice(0, 12);
    const sha = `app-${combined}${resolved.map(p => `+${p.manifest.slug}@${p.manifest.version}`).join('')}`;
    result = await applyWorkspace({ ...loaded, sha, sourcePath: `${APP_INSTALL_SOURCE_PREFIX}${slugs.join(',')}` }, { orgId: opts.orgId, appliedBy: opts.appliedBy, additive: true, track });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { resolved, slugs, result, record: { hashes, contents, fields: await readFieldsAfter(opts.orgId, track), kept: track.kept } };
}

/**
 * Read back the rows an apply wrote, for the next baseline.
 * @param orgId - The project.
 * @param track - The apply's track.
 */
async function readFieldsAfter(orgId: string, track: BundleTrack): Promise<BundleFields> {
  const tables = { agent: agentSchema, mission: missionSchema, automation: automationSchema } as const;
  const rows: Parameters<typeof fieldsAfter>[1] = {};
  for (const resource of Object.keys(track.wrote) as TrackedResource[]) {
    const slugs = Object.keys(track.wrote[resource] ?? {});
    const table = tables[resource];
    if (slugs.length > 0) {
      rows[resource] = await db.select().from(table).where(and(eq(table.orgId, orgId), inArray(table.slug, slugs))) as Array<Record<string, unknown> & { slug: string }>;
    }
  }
  return fieldsAfter(track, rows);
}

/**
 * Put an install's or upgrade's record on its version row.
 * @param versionId - The row the apply wrote.
 * @param record - What to record.
 */
export async function recordBundle(versionId: number | null, record: AppBundleRecord): Promise<void> {
  if (versionId !== null) {
    await db.update(workspaceVersionSchema).set({ bundle: record }).where(eq(workspaceVersionSchema.id, versionId));
  }
}

/** Compiled chat graphs bake in the roster; a changed one must not be served stale. */
export async function flushRuntime(): Promise<void> {
  try {
    const { resetAgentRuntimeCache } = await import('@/services/agents/harness');
    resetAgentRuntimeCache();
  } catch { /* the rows are written; a stale cache is not worth failing over */ }
}
