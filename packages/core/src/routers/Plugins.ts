import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { listPlugins, listPluginSlugs } from '@/libs/workspace/plugins';
import { enabledPluginsForOrg, pluginWriteTarget, togglePluginForProject } from '@/services/PluginService';
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
