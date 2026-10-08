import { installedApps, splitNavByApp } from '@/features/navigation/apps';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { pluginNav } from '@/features/navigation/pluginNav';
import { safeListApps } from '@/libs/workspace/apps';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { listPlugins } from '@/libs/workspace/plugins';
import { mountedWorkspaceIsProjects, projectPagesFolder } from '@/services/WorkspaceMountService';

/**
 * One workspace's nav, split between its apps — what the shell's rail and
 * sidebar draw, and what the Apps pages read for where "Open" lands. One
 * reader, so an app opens in the same place from the rail and from Apps.
 *
 * Where each enabled plugin's rows sit (plugin.yaml `nav.section`): its
 * pages, the core routes it owns and its surfaces fold into one section, so
 * the generic Pages and surface groups skip what a plugin claimed. A plugin
 * only this project turned on lists its pages under a shared mount; the
 * mounted folder's own pages (and its plugins') list only for the project
 * that folder was applied to.
 * @param input
 * @param input.orgId - The project, or null outside one.
 * @param input.enabledPlugins - `project.enabled_plugins`.
 * @param input.enabledSurfaces - `project.enabled_surfaces`.
 */
export async function workspaceAppNav(input: { orgId: string | null; enabledPlugins: string[]; enabledSurfaces: string[] }) {
  const { orgId, enabledPlugins, enabledSurfaces } = input;
  const mounted = orgId ? await mountedWorkspaceIsProjects(orgId).catch(() => false) : true;
  const ownDir = orgId && !mounted ? await projectPagesFolder(orgId).catch(() => null) : null;
  const pages = readWorkspacePages({ enabledPlugins, mounted, dir: ownDir }).pages;
  const nav = pluginNav({
    plugins: safeListPlugins().filter(p => enabledPlugins.includes(p.manifest.slug)).map(p => p.manifest),
    pages,
    routes: DASHBOARD_ROUTES,
  });
  return splitNavByApp({
    apps: installedApps(enabledPlugins, enabledSurfaces, safeListApps()),
    nav,
    surfaces: enabledSurfaces.filter(id => !nav.claimedSurfaces.includes(id)),
    pages: pages.filter(p => !p.nav.hidden && !nav.claimedPages.includes(p.slug)).map(p => ({ title: p.title, url: p.href ?? `/dashboard/p/${p.slug}`, section: p.nav.section, secondary: p.nav.secondary })),
    coreRoutes: DASHBOARD_ROUTES,
  });
}

/** The plugin catalogue, or nothing — a broken plugin.yaml must never take the shell down. */
export function safeListPlugins(): ReturnType<typeof listPlugins> {
  try {
    return listPlugins();
  } catch {
    return [];
  }
}
