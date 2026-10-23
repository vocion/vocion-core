import { installedApps, splitNavByApp } from '@/features/navigation/apps';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { pluginNav } from '@/features/navigation/pluginNav';
import { safeListApps } from '@/libs/workspace/apps';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { listPlugins } from '@/libs/workspace/plugins';

/**
 * The apps this workspace does NOT have, each with the pages it would own —
 * so a deep link into one (a bookmark, a link someone shared) is recognised
 * and the shell can say the app is elsewhere rather than open on nothing.
 * Read from the catalogue alone (core's plugin pages, routes and surfaces),
 * never another workspace's folder.
 * @param enabledPlugins - `project.enabled_plugins`.
 * @param enabledSurfaces - `project.enabled_surfaces`.
 */
export function appsElsewhere(enabledPlugins: readonly string[], enabledSurfaces: readonly string[]): Array<{ id: string; name: string; core: boolean; owns: string[] }> {
  const catalogue = safeListApps();
  const here = new Set(installedApps(enabledPlugins, enabledSurfaces, catalogue).map(a => a.id));
  const missing = catalogue.filter(a => !a.hidden && !a.core && !here.has(a.id));
  if (missing.length === 0) {
    return [];
  }
  const plugins = [...new Set(missing.flatMap(a => a.plugins))];
  const surfaces = [...new Set(missing.flatMap(a => a.surfaces))];
  const pages = readWorkspacePages({ enabledPlugins: plugins, mounted: false, dir: null }).pages;
  const nav = pluginNav({
    plugins: listPluginsSafely().filter(p => plugins.includes(p.manifest.slug)).map(p => p.manifest),
    pages,
    routes: DASHBOARD_ROUTES,
  });
  const split = splitNavByApp({ apps: missing, nav, surfaces: surfaces.filter(id => !nav.claimedSurfaces.includes(id)), pages: [], coreRoutes: DASHBOARD_ROUTES });
  return split.apps.map(a => ({ id: a.id, name: a.name, core: false, owns: a.owns }));
}

function listPluginsSafely(): ReturnType<typeof listPlugins> {
  try {
    return listPlugins();
  } catch {
    return [];
  }
}
