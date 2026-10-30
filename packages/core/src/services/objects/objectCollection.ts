import { objectCollection } from '@/libs/workspace/objectCollection';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { enabledPluginsForOrg } from '@/services/PluginService';
import { mountedWorkspaceIsProjects, projectPagesFolder } from '@/services/WorkspaceMountService';
import { recordLinksForOrg } from './recordHref';

/**
 * A workspace-scoped parent list; an unavailable manifest falls back to its object index.
 * @param orgId
 * @param objectType
 */
export async function objectCollectionForOrg(orgId: string, objectType: string) {
  const { workspaceSlug } = await recordLinksForOrg(orgId);
  try {
    const [enabledPlugins, mounted] = await Promise.all([enabledPluginsForOrg(orgId), mountedWorkspaceIsProjects(orgId)]);
    const dir = mounted ? null : await projectPagesFolder(orgId);
    const { pages } = readWorkspacePages({ enabledPlugins, mounted, dir });
    return objectCollection(pages, objectType, workspaceSlug);
  } catch {
    return objectCollection([], objectType, workspaceSlug);
  }
}
