import type { AppNav } from '@/features/navigation/apps';
import { workspaceAppNav } from '@/features/dashboard/workspaceAppNav';
import { appOwningPath } from '@/features/navigation/apps';
import { parseWorkspacePath } from '@/libs/links';

/**
 * Validate the tab's workspace before consulting any navigation manifests.
 * @param referer
 * @param workspaceSlug
 */
function refererPath(referer: string | null | undefined, workspaceSlug: string): string | null {
  if (!referer) {
    return null;
  }
  try {
    const url = new URL(referer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    const path = parseWorkspacePath(url.pathname);
    return path?.slug === workspaceSlug.trim().toLowerCase() ? path.appPath : null;
  } catch {
    return null;
  }
}

/**
 * Resolve owned routes with the same longest-prefix rule the sidebar uses.
 * @param referer - The browser tab that sent the turn.
 * @param workspaceSlug - The authenticated workspace's slug.
 * @param apps - Only that workspace's installed app navigation.
 */
export function ownedPageApp(referer: string | null | undefined, workspaceSlug: string, apps: readonly Pick<AppNav, 'id' | 'core' | 'owns'>[]): string | null {
  const path = refererPath(referer, workspaceSlug);
  return path ? appOwningPath(path, apps) ?? null : null;
}

/**
 * Read just this workspace's installed navigation, without enumerating other workspaces.
 * @param input - Workspace facts already read for chat routing, and its tab URL.
 * @param input.orgId
 * @param input.workspaceSlug
 * @param input.referer
 * @param input.enabledPlugins
 * @param input.enabledSurfaces
 */
export async function loadOwnedPageApp(input: {
  orgId: string;
  workspaceSlug: string;
  referer: string | null | undefined;
  enabledPlugins: string[];
  enabledSurfaces: string[];
}): Promise<string | null> {
  if (!refererPath(input.referer, input.workspaceSlug)) {
    return null;
  }
  try {
    const nav = await workspaceAppNav({ orgId: input.orgId, enabledPlugins: input.enabledPlugins, enabledSurfaces: input.enabledSurfaces });
    return ownedPageApp(input.referer, input.workspaceSlug, nav.apps);
  } catch {
    return null;
  }
}
