/**
 * AN INSTALLED APP FOLLOWS CORE'S NEW VERSION.
 *
 * Turning an app on in a workspace with no folder (every Vocion Cloud
 * workspace) applies its plugins' bundles once (`installBundle.ts`). Until
 * this, nothing applied them again: when core shipped new templates — a tool
 * newly granted to an agent, a rewritten prompt, a new skill or object field —
 * an installed workspace kept the agents it was installed with for ever. On
 * 2026-10-27 an SEO strategist on Cloud dev ran without the two tools its
 * release had granted it, on its old prompt.
 *
 * So on boot, the scheduler-of-record walks every workspace with an app
 * installed and re-applies, additively, each plugin that is still on and whose
 * templates (hashed from the files this image ships) differ from the hash its
 * last install recorded. An unchanged plugin costs one directory hash and no
 * write. An install from before hashes were recorded has none, so its first
 * pass brings it up to date.
 *
 * - **A person's change is kept.** A field a person changed since the bundle
 *   last wrote it stays as they left it, and the version row records it as
 *   kept (`libs/workspace/bundleTrack.ts`). An autonomy rung moved in the app
 *   keeps its rung.
 * - **What the new templates dropped** is disabled the way turning the app off
 *   disables it — missions and automations to `disabled`, agents inactive —
 *   and every row is kept.
 * - **Recorded** as a `workspace_version` row (`app:<plugins>`, applied by
 *   `system:app-upgrade`), so the Workspace page shows the app moved, and when.
 * - **Never** a workspace applied from a folder (its deploy re-applies its
 *   manifest), and never a plugin turned off.
 *
 * One process at a time, under an advisory lock: a rolling deploy runs two.
 */

import type { AppBundleRecord } from '@/libs/workspace/bundleTrack';
import { eq, like } from 'drizzle-orm';
import { withAdvisoryLock } from '@/libs/advisoryLock';
import { db } from '@/libs/DB';
import { listPluginSlugs, loadPlugin, resolvePlugins } from '@/libs/workspace/plugins';
import { projectSchema, workspaceVersionSchema } from '@/models/Schema';
import { ensureDefaultPlugins } from './defaultPlugins';
import { APP_INSTALL_SOURCE_PREFIX, appHistory, appliedFromFolder, applyAppBundles, disableBundleItems, flushRuntime, pluginTemplateHash, recordBundle } from './installBundle';

/** Who an upgrade's version row says applied it. */
export const APP_UPGRADE_BY = 'system:app-upgrade';

/** The lock one upgrade pass holds across processes. */
const LOCK = 'vocion:app-upgrade';

/** One workspace's app, moved to this image's templates. */
export type AppUpgrade = {
  orgId: string;
  /** The plugins applied, dependencies included. */
  plugins: string[];
  /** Each plugin's template hash before, null when none was recorded. */
  from: Record<string, string | null>;
  to: Record<string, string>;
  /** Fields left as a person changed them. */
  kept: AppBundleRecord['kept'];
  retired: NonNullable<AppBundleRecord['retired']>;
  errors: number;
  versionId: number | null;
};

export type AppUpgradeRun
  = | { skipped: 'locked' }
    | { checked: number; upgraded: AppUpgrade[]; failed: Array<{ orgId: string; message: string }>; defaults?: Awaited<ReturnType<typeof ensureDefaultPlugins>> };

/**
 * Bring every installed app up to this image's templates (or only these
 * workspaces'). Safe to run any number of times: a workspace already current
 * is a read and nothing else.
 * @param opts
 * @param opts.orgIds - Limit the pass to these workspaces.
 */
export async function upgradeInstalledApps(opts: { orgIds?: readonly string[] } = {}): Promise<AppUpgradeRun> {
  const run = await withAdvisoryLock(LOCK, async () => {
    // Plugins on by default reach every workspace first, once each
    // (`defaultPlugins.ts`); from then on they are installed apps like any other.
    const defaults = opts.orgIds ? undefined : await ensureDefaultPlugins();
    const orgIds = opts.orgIds ?? (await db
      .selectDistinct({ orgId: workspaceVersionSchema.orgId })
      .from(workspaceVersionSchema)
      .where(like(workspaceVersionSchema.sourcePath, `${APP_INSTALL_SOURCE_PREFIX}%`))).map(r => r.orgId);
    const upgraded: AppUpgrade[] = [];
    const failed: Array<{ orgId: string; message: string }> = [];
    for (const orgId of orgIds) {
      try {
        const done = await upgradeInstalledApp(orgId);
        if (done) {
          upgraded.push(done);
        }
      } catch (err) {
        failed.push({ orgId, message: (err as Error).message });
      }
    }
    return { checked: orgIds.length, upgraded, failed, ...(defaults ? { defaults } : {}) };
  });
  return run.ran ? run.value : { skipped: 'locked' };
}

/**
 * One workspace: re-apply each installed plugin that is on and whose
 * templates changed, keep what a person changed, disable what was dropped.
 * Null when there was nothing to do.
 * @param orgId - The project.
 */
export async function upgradeInstalledApp(orgId: string): Promise<AppUpgrade | null> {
  if (await appliedFromFolder(orgId)) {
    return null;
  }
  const [project] = await db
    .select({ name: projectSchema.name, timeZone: projectSchema.timeZone, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return null;
  }
  const history = await appHistory(orgId);
  const shipped = new Set(listPluginSlugs());
  const on = new Set(project.enabledPlugins ?? []);
  const installed = history.installed.filter(s => on.has(s) && shipped.has(s));
  const changed = installed.filter(s => history.hashes[s] !== pluginTemplateHash(loadPlugin(s)));
  if (changed.length === 0) {
    return null;
  }

  const { slugs, result, record } = await applyAppBundles({ orgId, plugins: changed, appliedBy: APP_UPGRADE_BY, project: { name: project.name, timeZone: project.timeZone ?? null }, history });

  // What the old templates shipped and the new ones do not — unless another
  // plugin that is still on ships it now.
  const shippedNow = new Set(resolvePlugins(installed).flatMap(p => Object.values(record.contents[p.manifest.slug] ?? history.contents[p.manifest.slug] ?? {}).flat()));
  const dropped = (kind: 'agents' | 'missions' | 'automations') => [...new Set(slugs.flatMap(s =>
    (history.contents[s]?.[kind] ?? []).filter(slug => !(record.contents[s]?.[kind] ?? []).includes(slug)),
  ))].filter(slug => !shippedNow.has(slug));
  const retired = { agents: dropped('agents'), missions: dropped('missions'), automations: dropped('automations') };
  if (retired.agents.length + retired.missions.length + retired.automations.length > 0) {
    await disableBundleItems(orgId, retired);
  }

  const from = Object.fromEntries(slugs.map(s => [s, history.hashes[s] ?? null]));
  await recordBundle(result.versionId, { ...record, from, retired });
  await flushRuntime();
  return { orgId, plugins: slugs, from, to: record.hashes, kept: record.kept, retired, errors: result.errors.length, versionId: result.versionId };
}

/**
 * At boot: run one upgrade pass, never awaited by the server. Only on the
 * scheduler-of-record (`VOCION_SCHEDULE_OWNER=1`), because the same apply
 * writes the schedules of new or changed automations and only that process
 * may; the lock covers a rolling deploy's two.
 */
export function startInstalledAppUpgrades(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.VOCION_SCHEDULE_OWNER !== '1' || process.env.VOCION_APP_UPGRADE === 'off') {
    return;
  }
  void upgradeInstalledApps()
    .then((out) => {
      if ('skipped' in out) {
        console.warn('[apps] upgrade pass skipped: another process holds it');
        return;
      }
      for (const d of out.defaults?.added ?? []) {
        console.warn('[apps] default plugins turned on', d);
      }
      for (const f of out.defaults?.failed ?? []) {
        console.error('[apps] could not turn on the default plugins', f);
      }
      for (const u of out.upgraded) {
        console.warn('[apps] installed app moved to this version', { orgId: u.orgId, plugins: u.plugins, kept: u.kept.length, retired: u.retired, errors: u.errors });
      }
      for (const f of out.failed) {
        console.error('[apps] could not upgrade an installed app', f);
      }
    })
    .catch(err => console.error('[apps] upgrade pass failed', (err as Error).message));
}
