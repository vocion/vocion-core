/**
 * Apps in the dashboard — which apps a workspace has, which rows belong to
 * which app, and which app a URL is in.
 *
 * An app (`templates/apps/<id>/app.yaml`, `libs/workspace/apps.ts`) is a named
 * set of plugins and the nav sections their rows sit in. It is installed in a
 * workspace exactly when one of its plugins or surfaces is on there, so
 * `project.enabled_plugins` stays the one record of what a workspace has and
 * turning a plugin on is still the only way to add capability. The `core` app
 * (Workforce) is installed everywhere and keeps every row no other app
 * claims, so a plugin that belongs to no app sits where it always did.
 *
 * Everything here reads the manifests it is handed. No app id, plugin slug or
 * section name is written into this module: the core app is the one marked
 * `core: true`, and a row's app is the app whose manifest lists its plugin,
 * its surface or its section.
 *
 * Pure data, no React and no filesystem, so the shell (server) and the
 * sidebar (client) share it. Tested in `apps.test.ts`.
 */

import type { PluginNav, PluginNavItem } from './pluginNav';
import type { Tint } from '@/libs/tints';
import type { AppManifest } from '@/libs/workspace/schemas';
import { resolveTint } from '@/libs/tints';
import { PLUGIN_NAV_WORKSPACE } from './pluginNav';
import { SURFACES } from './surfaces';

/** What an app needs to be resolved — the manifest, minus the prose. */
export type AppDefinition = Pick<AppManifest, 'id' | 'name' | 'icon' | 'order' | 'core' | 'hidden' | 'plugins' | 'surfaces' | 'entry' | 'nav'> & Partial<Pick<AppManifest, 'tint'>>;

/** What the rail draws for one app, and where it opens in a workspace that has it. */
export type AppSummary = { id: string; name: string; icon: string; order: number; core: boolean; entry: string; tint: Tint };

/** A workspace in an app's picker. */
export type AppWorkspace = { projectId: string; slug: string; name: string };

/** One row of an app's nav. `icon` is a lucide name; the sidebar resolves it. */
export type AppNavItem = { title: string; url: string; icon: string; secondary?: boolean };

/** An app as one workspace has it: its rail entry, where picking it lands, and its rows. */
export type AppNav = AppSummary & {
  /** Where picking the app in the rail lands in this workspace. */
  href: string;
  /** The app's sections, its own rows only. Empty for the core app, whose rows the sidebar builds. */
  sections: Array<{ label: string; items: AppNavItem[] }>;
  /** URL prefixes that belong to this app — a page under one of them is "in" the app. */
  owns: string[];
};

/** A workspace the person can open, with what is on there. */
export type AccessibleWorkspace = AppWorkspace & { enabledPlugins: readonly string[]; enabledSurfaces: readonly string[] };

/** A workspace page as the shell lists it (`libs/workspace/pages.ts`). */
export type NavPageInput = { title: string; url: string; section: string; secondary?: boolean };

/**
 * The app every workspace has (`core: true`), if the catalogue has one.
 * @param apps - The app catalogue.
 */
export function coreApp<T extends Pick<AppDefinition, 'core'>>(apps: readonly T[]): T | undefined {
  return apps.find(a => a.core);
}

/**
 * The rail's view of an app.
 * @param app - Its manifest.
 */
export function appSummary(app: Pick<AppDefinition, 'id' | 'name' | 'icon' | 'order' | 'core' | 'entry' | 'tint'>): AppSummary {
  return { id: app.id, name: app.name, icon: app.icon, order: app.order, core: app.core, entry: app.entry, tint: resolveTint(app.tint, app.id) };
}

/**
 * The apps a workspace has, in rail order: the core app always; any other app
 * when at least one of its plugins or surfaces is on; a hidden app never (it
 * is a registry slot, not something to pick).
 * @param enabledPlugins - `project.enabled_plugins`.
 * @param enabledSurfaces - `project.enabled_surfaces`.
 * @param apps - The app catalogue.
 */
export function installedApps<T extends AppDefinition>(enabledPlugins: readonly string[], enabledSurfaces: readonly string[], apps: readonly T[]): T[] {
  const plugins = new Set(enabledPlugins);
  const surfaces = new Set(enabledSurfaces);
  return apps
    .filter(a => !a.hidden && (a.core || a.plugins.some(p => plugins.has(p)) || a.surfaces.some(s => surfaces.has(s))))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * For the rail and its pickers: the apps the person has in at least one
 * workspace (the core app always), and, per app, the workspaces that have it.
 * Workspaces keep the order they arrive in.
 * @param workspaces - Every workspace the person can open, with what is on there.
 * @param apps - The app catalogue.
 */
export function workspacesByApp(workspaces: readonly AccessibleWorkspace[], apps: readonly AppDefinition[]): { apps: AppSummary[]; workspacesByApp: Record<string, AppWorkspace[]> } {
  const byApp: Record<string, AppWorkspace[]> = {};
  const core = coreApp(apps);
  if (core && !core.hidden) {
    byApp[core.id] = [];
  }
  for (const w of workspaces) {
    for (const app of installedApps(w.enabledPlugins, w.enabledSurfaces, apps)) {
      (byApp[app.id] ??= []).push({ projectId: w.projectId, slug: w.slug, name: w.name });
    }
  }
  const listed = apps
    .filter(a => byApp[a.id] !== undefined)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(appSummary);
  return { apps: listed, workspacesByApp: byApp };
}

/**
 * The non-core app a nav section belongs to, by the labels apps declare.
 * @param label - A section label (`plugin.yaml` / page `nav.section`).
 * @param apps - The apps installed in this workspace.
 */
export function appOwningSection<T extends AppDefinition>(label: string, apps: readonly T[]): T | undefined {
  return apps.find(a => !a.core && a.nav.includes(label));
}

/**
 * The non-core app a plugin row belongs to: the app that lists the plugin,
 * else the app that owns the row's section. Undefined means the core app.
 * @param plugin - The plugin that put the row there.
 * @param section - The section the row sits in.
 * @param apps - The apps installed in this workspace.
 */
export function appOwningPluginRow<T extends AppDefinition>(plugin: string, section: string, apps: readonly T[]): T | undefined {
  return apps.find(a => !a.core && a.plugins.includes(plugin)) ?? appOwningSection(section, apps);
}

/**
 * The non-core app a surface belongs to: the app that lists it, else the app
 * that owns the surface's registered section.
 * @param id - A surface id (`features/navigation/surfaces.ts`).
 * @param apps - The apps installed in this workspace.
 */
export function appOwningSurface<T extends AppDefinition>(id: string, apps: readonly T[]): T | undefined {
  const surface = (SURFACES as Record<string, { section: string }>)[id];
  return apps.find(a => !a.core && a.surfaces.includes(id)) ?? (surface ? appOwningSection(surface.section, apps) : undefined);
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Split one workspace's nav between its apps.
 *
 * Every row the shell gathered — each plugin's rows (`pluginNav`), the
 * surfaces no plugin claimed and the workspace's own pages — goes to the app
 * that owns it; what no other app owns stays with the core app, in exactly
 * the shape the sidebar already draws. A plugin row in the default
 * (`Workspace`) section sits under its app's first section, and a workspace
 * page that names an app's section — a customisation of the app — sits inside
 * that app, never as an app of its own.
 *
 * `owns` is what puts a URL in an app: its own pages and surfaces, and a core
 * route only when the app's plugin owns that route (`DashboardRoute.plugin`).
 * A page that merely links to a core route (a "Team report" row) does not
 * pull that route out of the core app.
 * @param input - The workspace's installed apps and every row the shell gathered.
 * @param input.apps - `installedApps(...)` for this workspace.
 * @param input.nav - `pluginNav(...)` for this workspace.
 * @param input.surfaces - Enabled surface ids no plugin claimed.
 * @param input.pages - Workspace pages no plugin claimed.
 * @param input.coreRoutes - The core route registry (`DASHBOARD_ROUTES`).
 */
export function splitNavByApp(input: {
  apps: readonly AppDefinition[];
  nav: PluginNav;
  surfaces: readonly string[];
  pages: readonly NavPageInput[];
  coreRoutes: ReadonlyArray<{ url: string; plugin?: string }>;
}): { core: { nav: PluginNav; surfaces: string[]; pages: NavPageInput[] }; apps: AppNav[] } {
  const sections = new Map<string, Map<string, Array<AppNavItem & { order: number }>>>();
  const owns = new Map<string, Set<string>>();
  const coreRoute = new Map(input.coreRoutes.map(r => [r.url, r]));
  const add = (app: AppDefinition, label: string, item: AppNavItem & { order: number }, plugin?: string) => {
    const relabelled = label === PLUGIN_NAV_WORKSPACE ? (app.nav[0] ?? app.name) : label;
    const bySection = sections.get(app.id) ?? new Map<string, Array<AppNavItem & { order: number }>>();
    bySection.set(relabelled, [...(bySection.get(relabelled) ?? []), item]);
    sections.set(app.id, bySection);
    const path = pathOf(item.url);
    const route = coreRoute.get(path);
    if (!route || (route.plugin !== undefined && plugin !== undefined && route.plugin === plugin && app.plugins.includes(plugin))) {
      owns.set(app.id, (owns.get(app.id) ?? new Set()).add(path));
    }
  };

  const coreSections: PluginNav['sections'] = [];
  for (const section of input.nav.sections) {
    const kept: PluginNavItem[] = [];
    for (const item of section.items) {
      const app = appOwningPluginRow(item.plugin, section.label, input.apps);
      if (app) {
        add(app, section.label, { title: item.title, url: item.url, icon: item.icon, order: item.order, ...(item.secondary ? { secondary: true } : {}) }, item.plugin);
      } else {
        kept.push(item);
      }
    }
    if (kept.length > 0) {
      coreSections.push({ label: section.label, items: kept });
    }
  }

  const coreSurfaces: string[] = [];
  for (const id of input.surfaces) {
    const app = appOwningSurface(id, input.apps);
    const surface = (SURFACES as Record<string, { url: string; label: string; icon: string; section: string }>)[id];
    if (app && surface) {
      add(app, surface.section, { title: surface.label, url: surface.url, icon: surface.icon, order: 0 });
    } else {
      coreSurfaces.push(id);
    }
  }

  const corePages: NavPageInput[] = [];
  for (const page of input.pages) {
    const app = appOwningSection(page.section, input.apps);
    if (app) {
      add(app, page.section, { title: page.title, url: page.url, icon: 'panels-top-left', order: 1000, ...(page.secondary ? { secondary: true } : {}) });
    } else {
      corePages.push(page);
    }
  }

  const apps = input.apps.map((app): AppNav => {
    const bySection = sections.get(app.id) ?? new Map();
    // The app's declared sections first, in its order; anything else after.
    const labels = [...new Set([...app.nav.filter(l => bySection.has(l)), ...bySection.keys()])];
    const appSections = labels.map(label => ({
      label,
      items: [...bySection.get(label)!]
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
        .map(({ order: _order, ...item }) => item),
    }));
    const rows = appSections.flatMap(s => s.items);
    const primary = rows.filter(i => !i.secondary);
    const href = app.core
      ? app.entry
      : (rows.some(i => pathOf(i.url) === app.entry) ? app.entry : (primary[0] ?? rows[0])?.url ?? app.entry);
    return { ...appSummary(app), href, sections: app.core ? [] : appSections, owns: [...(owns.get(app.id) ?? [])] };
  });

  return {
    core: { nav: { ...input.nav, sections: coreSections }, surfaces: coreSurfaces, pages: corePages },
    apps,
  };
}

/**
 * The non-core app a path is in, by the longest prefix any app owns.
 * @param pathname - The locale-stripped path, no query string.
 * @param apps - This workspace's apps.
 */
export function appOwningPath(pathname: string, apps: readonly Pick<AppNav, 'id' | 'core' | 'owns'>[]): string | undefined {
  let best: { id: string; length: number } | undefined;
  for (const app of apps) {
    if (app.core) {
      continue;
    }
    for (const prefix of app.owns) {
      if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && (!best || prefix.length > best.length)) {
        best = { id: app.id, length: prefix.length };
      }
    }
  }
  return best?.id;
}

/**
 * Which app the sidebar shows.
 *
 * A page an app owns is in that app, so a link or a refresh lands on the
 * right app with nothing stored. A page no app owns — Chat, Review, the wiki,
 * a record opened from an app's list — is shared, and keeps the app the
 * person was last in while this workspace has it. A pick in the rail that
 * did not navigate (an app this workspace does not have) holds until the
 * person moves. Anything else is the core app.
 * @param input - The current path and what the person last chose.
 * @param input.pathname - The locale-stripped path.
 * @param input.apps - This workspace's apps (`splitNavByApp(...).apps`).
 * @param input.remembered - The app the person was last in, if any.
 * @param input.pick - A rail pick that did not navigate (`appId`), and the path it was made on (`path`).
 * @param input.known - Every app the rail shows, for a pick of one this workspace lacks.
 */
export function resolveActiveApp(input: {
  pathname: string;
  apps: readonly Pick<AppNav, 'id' | 'core' | 'owns'>[];
  remembered?: string | null;
  pick?: { appId: string; path: string } | null;
  known?: readonly string[];
}): string | undefined {
  const core = input.apps.find(a => a.core)?.id;
  if (input.pick && input.pick.path === input.pathname && (input.apps.some(a => a.id === input.pick!.appId) || input.known?.includes(input.pick.appId))) {
    return input.pick.appId;
  }
  const owner = appOwningPath(input.pathname, input.apps);
  if (owner) {
    return owner;
  }
  if (input.remembered && input.apps.some(a => a.id === input.remembered)) {
    return input.remembered;
  }
  return core;
}

/**
 * Where a workspace switch lands. The same page when both workspaces have the
 * app the person is in (the core app is everywhere); the app's entry when the
 * person picked an app this workspace lacks and is choosing where to open
 * it; the core app's entry when the target lacks the app, since a page of an
 * app the target does not have would open on nothing.
 * @param input - The switch.
 * @param input.pathname - The current locale-stripped path.
 * @param input.activeApp - The app the sidebar shows.
 * @param input.hereApps - Ids of the apps the current workspace has.
 * @param input.targetApps - Ids of the apps the target workspace has.
 * @param input.appEntry - The active app's entry route.
 * @param input.coreEntry - The core app's entry route.
 */
export function workspaceSwitchPath(input: { pathname: string; activeApp: string | undefined; hereApps: readonly string[]; targetApps: readonly string[]; appEntry?: string; coreEntry: string }): string {
  if (!input.activeApp) {
    return input.pathname;
  }
  if (!input.targetApps.includes(input.activeApp)) {
    return input.coreEntry;
  }
  if (!input.hereApps.includes(input.activeApp)) {
    return input.appEntry ?? input.coreEntry;
  }
  return input.pathname;
}

/**
 * The plugin catalogue grouped under the apps they make up — the
 * marketplace's view, where an app's plugins are its features. Each non-core
 * app takes the plugins it lists, in its order; the core app takes every
 * plugin no app lists, in catalogue order. Hidden apps and apps with no
 * plugin in the catalogue are left out.
 * @param pluginSlugs - The plugin catalogue, in its order.
 * @param apps - The app catalogue.
 */
export function groupPluginsByApp<T extends AppDefinition>(pluginSlugs: readonly string[], apps: readonly T[]): Array<{ app: T; plugins: string[] }> {
  const catalogue = new Set(pluginSlugs);
  const visible = apps.filter(a => !a.hidden).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const listed = new Set(visible.filter(a => !a.core).flatMap(a => a.plugins));
  return visible
    .map(app => ({ app, plugins: app.core ? pluginSlugs.filter(s => !listed.has(s)) : app.plugins.filter(s => catalogue.has(s)) }))
    .filter(g => g.plugins.length > 0);
}
