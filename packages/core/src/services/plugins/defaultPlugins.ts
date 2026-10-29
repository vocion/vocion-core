/**
 * PLUGINS ON BY DEFAULT — the ones core ships for every shared workspace
 * (`defaultOn: true` in `plugin.yaml`), such as the Workspace manager.
 *
 * A plugin is on where `project.enabled_plugins` names it, so "on by default"
 * is a write, made in two places:
 *
 *   - a new shared workspace gets every default plugin when it is created
 *     (`createSharedWorkspace`);
 *   - on boot, the scheduler-of-record adds each default plugin, once, to
 *     every existing shared workspace with no folder (`startInstalledAppUpgrades`
 *     runs it before the upgrade pass), so a workspace made before the plugin
 *     shipped gets it through the same install path an app's plugins take.
 *     The upgrade pass then keeps it current like any installed app.
 *
 * **Off sticks.** A plugin that was ever installed in a workspace — its slug
 * is in the workspace's app history — is never added back: a person who
 * turned it off keeps it off. A personal workspace is never touched, and a
 * workspace applied from a folder lists its plugins in `workspace.yaml`.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { listPluginSlugs, loadPlugin } from '@/libs/workspace/plugins';
import { projectSchema } from '@/models/Schema';
import { appHistory, appliedFromFolder } from './installBundle';

/** Who a default install's version row says applied it. */
export const DEFAULT_PLUGINS_BY = 'system:default-plugins';

/** The plugins this image turns on by default, in a stable order. */
export function defaultOnPluginSlugs(): string[] {
  return listPluginSlugs().filter((slug) => {
    try {
      return loadPlugin(slug).manifest.defaultOn === true;
    } catch {
      return false;
    }
  }).sort();
}

/**
 * The default plugins one workspace is missing and may be given: not on, and
 * never installed before (so never turned off by a person). Pure.
 * @param defaults - The default-on slugs.
 * @param enabled - The workspace's `enabled_plugins`.
 * @param everInstalled - Every plugin its app history has installed.
 */
export function missingDefaults(defaults: readonly string[], enabled: readonly string[], everInstalled: readonly string[]): string[] {
  const on = new Set(enabled);
  const before = new Set(everInstalled);
  return defaults.filter(s => !on.has(s) && !before.has(s));
}

/**
 * Give one shared workspace its missing default plugins. Null when there was
 * nothing to do; the slugs added otherwise.
 * @param orgId - The workspace.
 * @param appliedBy - Who the install is recorded as.
 */
export async function ensureDefaultPluginsFor(orgId: string, appliedBy: string = DEFAULT_PLUGINS_BY): Promise<string[] | null> {
  const defaults = defaultOnPluginSlugs();
  if (defaults.length === 0) {
    return null;
  }
  const [project] = await db
    .select({ slug: projectSchema.slug, kind: projectSchema.kind, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project || project.kind === 'personal' || await appliedFromFolder(orgId)) {
    return null;
  }
  const history = await appHistory(orgId);
  const missing = missingDefaults(defaults, project.enabledPlugins ?? [], history.installed);
  if (missing.length === 0) {
    return null;
  }
  const { addPluginsForProject } = await import('@/services/PluginService');
  await addPluginsForProject({ orgId, projectSlug: project.slug, workspaceDir: null, slugs: missing, appliedBy });
  return missing;
}

/**
 * Every shared workspace with no folder gets its missing default plugins.
 * One failing workspace is reported and the rest still go.
 */
export async function ensureDefaultPlugins(): Promise<{ added: Array<{ orgId: string; plugins: string[] }>; failed: Array<{ orgId: string; message: string }> }> {
  const out = { added: [] as Array<{ orgId: string; plugins: string[] }>, failed: [] as Array<{ orgId: string; message: string }> };
  if (defaultOnPluginSlugs().length === 0) {
    return out;
  }
  const projects = await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.kind, 'shared'));
  for (const { id } of projects) {
    try {
      const added = await ensureDefaultPluginsFor(id);
      if (added) {
        out.added.push({ orgId: id, plugins: added });
      }
    } catch (err) {
      out.failed.push({ orgId: id, message: (err as Error).message });
    }
  }
  return out;
}
