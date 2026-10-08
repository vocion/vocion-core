import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { safeListApps } from '@/libs/workspace/apps';
import { listPlugins, listPluginSlugs } from '@/libs/workspace/plugins';
import { enabledPluginsForOrg, pluginWriteTarget, restorePluginsForProject, togglePluginForProject } from '@/services/PluginService';
import { guardAuth, guardRole, loadProject } from './AuthGuards';
import { workspaceFolderForProject } from './Workspace';

/**
 * Plugins — the catalogue this core ships, which of them the active project
 * has on, and the switch. `set` edits the project's workspace.yaml and applies
 * it when the folder on this host is the project's own; for any other project
 * under the same mount it updates `project.enabled_plugins` and says which
 * repo file makes it stick (`services/PluginService.ts`, `pluginWriteTarget`).
 * Admin-gated because an apply rewrites the project's agents, skills and
 * missions.
 */

/**
 * The folder resolved for the project and where a toggle may write.
 * @param orgId
 * @param projectId
 */
async function targetFor(orgId: string, projectId: string) {
  const [project, folder] = await Promise.all([loadProject(projectId), workspaceFolderForProject(projectId)]);
  return { folder, target: await pluginWriteTarget(orgId, project?.slug ?? projectId, folder?.path ?? null, folder?.explicit ?? false) };
}

export const list = os.handler(async () => {
  const { orgId, projectId } = await guardAuth();
  const enabled = await enabledPluginsForOrg(orgId!);
  const { target } = await targetFor(orgId!, projectId!);
  return {
    enabled,
    /** Why the switch is off on this host, or null when a toggle can write. */
    writeBlocker: target.blocker,
    /** `workspace`: a toggle edits the folder and applies. `project`: it updates this project's list only, and `repoFile` is the door. */
    writes: target.mode,
    repoFile: target.repoFile,
    plugins: listPlugins().map(p => ({
      slug: p.manifest.slug,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      depends: p.manifest.depends,
      surfaces: p.manifest.surfaces,
      recommend: p.manifest.recommend,
      contents: p.contents,
      enabled: enabled.includes(p.manifest.slug),
    })),
  };
});

export const set = os
  .input(z.object({
    slug: z.string().min(1).max(60),
    enabled: z.boolean(),
  }))
  .handler(async ({ input }) => {
    const { orgId, projectId } = await guardRole('org:admin');
    const { userId } = await guardAuth();
    if (!listPluginSlugs().includes(input.slug)) {
      throw new ORPCError('NOT_FOUND', { message: `unknown plugin "${input.slug}"` });
    }
    const [project, folder] = await Promise.all([loadProject(projectId!), workspaceFolderForProject(projectId!)]);
    try {
      return await togglePluginForProject({ orgId: orgId!, projectSlug: project?.slug ?? projectId!, workspaceDir: folder?.path ?? null, explicit: folder?.explicit ?? false, slug: input.slug, enabled: input.enabled, appliedBy: userId ? `user:${userId}` : 'ui-plugins' });
    } catch (err) {
      throw new ORPCError('APPLY_FAILED', { message: err instanceof Error ? err.message : String(err) });
    }
  });

/**
 * Add an app to the active project: turn on every feature (plugin) the app's
 * manifest lists, in one write and one apply — the same path the switch and
 * its undo take (`restorePluginsForProject`), so the app arrives in the rail
 * exactly as if each feature had been switched on. A feature can be switched
 * off afterwards on the app's page.
 */
export const addApp = os
  .input(z.object({ id: z.string().min(1).max(60) }))
  .handler(async ({ input }) => {
    const { orgId, projectId } = await guardRole('org:admin');
    const { userId } = await guardAuth();
    const app = safeListApps().find(a => a.id === input.id && !a.hidden);
    if (!app) {
      throw new ORPCError('NOT_FOUND', { message: `unknown app "${input.id}"` });
    }
    const catalogue = new Set(listPluginSlugs());
    const before = await enabledPluginsForOrg(orgId!);
    const next = [...new Set([...before, ...app.plugins.filter(s => catalogue.has(s))])];
    const [project, folder] = await Promise.all([loadProject(projectId!), workspaceFolderForProject(projectId!)]);
    try {
      const res = await restorePluginsForProject({ orgId: orgId!, projectSlug: project?.slug ?? projectId!, workspaceDir: folder?.path ?? null, explicit: folder?.explicit ?? false, plugins: next, appliedBy: userId ? `user:${userId}` : 'ui-apps' });
      return { id: app.id, before, after: next, ...res };
    } catch (err) {
      throw new ORPCError('APPLY_FAILED', { message: err instanceof Error ? err.message : String(err) });
    }
  });
