import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { listPlugins, listPluginSlugs } from '@/libs/workspace/plugins';
import { enabledPluginsForOrg, setPluginEnabled, workspaceWriteBlocker } from '@/services/PluginService';
import { guardAuth, guardRole } from './AuthGuards';
import { workspacePathForProject } from './Workspace';

/**
 * Plugins — the catalogue this core ships, which of them the active project
 * has on, and the switch. `set` edits the project's workspace.yaml and applies
 * it (`services/PluginService.ts`); admin-gated because an apply rewrites the
 * project's agents, skills and missions.
 */

export const list = os.handler(async () => {
  const { orgId, projectId } = await guardAuth();
  const enabled = await enabledPluginsForOrg(orgId!);
  const dir = await workspacePathForProject(projectId!);
  return {
    enabled,
    /** Why the switch is off on this host, or null when a toggle can write. */
    writeBlocker: dir ? workspaceWriteBlocker(dir) : 'this project has no workspace directory on this host',
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
    const dir = await workspacePathForProject(projectId!);
    if (!dir) {
      throw new ORPCError('NOT_FOUND', { message: 'no workspace directory for this project on this host — edit workspace.yaml in the workspace repo' });
    }
    try {
      return await setPluginEnabled({ orgId: orgId!, workspaceDir: dir, slug: input.slug, enabled: input.enabled, appliedBy: userId ? `user:${userId}` : 'ui-plugins' });
    } catch (err) {
      throw new ORPCError('APPLY_FAILED', { message: err instanceof Error ? err.message : String(err) });
    }
  });
