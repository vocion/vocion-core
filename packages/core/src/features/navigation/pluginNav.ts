/**
 * Plugin navigation — where a plugin's rows sit, decided once in `plugin.yaml`.
 *
 * A plugin reaches the sidebar three ways: its `pages/` (rendered at
 * `/dashboard/p/<slug>`), the core routes it owns (`DashboardRoute.plugin`,
 * e.g. Data rooms) and the surfaces it switches on (`plugin.yaml`
 * `surfaces:`). Before this they landed in three different groups — a page
 * under Pages, a route under More, a surface under GTM (Chris, 2026-09-18:
 * "why is data rooms and wiki in diff places?"). Now `plugin.yaml` `nav.section`
 * says where ALL of them go, and this module folds the three sources into one
 * list of sections the sidebar renders. Default: `Workspace`, beside Chat and
 * Review; a plugin names a section only when it is part of a named app (GTM).
 *
 * Pure data, no React and no filesystem: the shell gathers the inputs, the
 * sidebar turns icon names into components. Tested in `pluginNav.test.ts`.
 */

import type { PluginManifest } from '@/libs/workspace/schemas';
import { SURFACES } from './surfaces';

/** A plugin page as the shell reads it — slug, title, its own nav, and which plugin shipped it. */
export type PluginPageInput = {
  slug: string;
  title: string;
  icon?: string;
  nav: { section: string; order: number; hidden: boolean };
  origin: string;
  /** Set when a workspace page replaces this plugin's page by slug. */
  overrides?: string;
  /** A `link` page's route — the row opens it directly instead of `/dashboard/p/<slug>`. */
  href?: string;
};

/** A core route a plugin owns, as the registry declares it. */
export type PluginRouteInput = { url: string; title: string; plugin?: string; offeredBy?: string; iconName?: string };

export type PluginNavItem = {
  title: string;
  url: string;
  /** lucide icon name; the sidebar resolves it, unknown falls back. */
  icon: string;
  plugin: string;
  order: number;
  /** Sits under the section's "More ›" whatever the row count — a core route the plugin offers but does not own. */
  secondary?: boolean;
};

export type PluginNavSection = {
  /** `Workspace`, `Pages`, or a custom heading. */
  label: string;
  items: PluginNavItem[];
};

export type PluginNav = {
  sections: PluginNavSection[];
  /** Surface ids a plugin claimed — the generic surface groups skip them. */
  claimedSurfaces: string[];
  /** Page slugs a plugin claimed — the Pages group skips them. */
  claimedPages: string[];
  /** Route urls a plugin claimed — the work group's pinnable rows skip them. */
  claimedRoutes: string[];
};

/** The section the sidebar already has; anything else is a heading of its own. */
export const PLUGIN_NAV_WORKSPACE = 'Workspace';

/**
 * Fold every enabled plugin's rows into sections.
 * @param input
 * @param input.plugins - Enabled plugins' manifests, in load order.
 * @param input.pages - Every workspace page the shell read (plugin pages carry `origin: plugin:<slug>`).
 * @param input.routes - The core route registry (only rows with `plugin` set are read).
 */
export function pluginNav(input: {
  plugins: readonly PluginManifest[];
  pages: readonly PluginPageInput[];
  routes: readonly PluginRouteInput[];
}): PluginNav {
  const sections = new Map<string, PluginNavItem[]>();
  const claimedSurfaces: string[] = [];
  const claimedPages: string[] = [];
  const claimedRoutes: string[] = [];
  const push = (label: string, item: PluginNavItem) => {
    const list = sections.get(label) ?? [];
    list.push(item);
    sections.set(label, list);
  };

  for (const plugin of input.plugins) {
    const section = plugin.nav.section;
    const base = plugin.nav.order;
    // Its pages — a page's own nav.section wins when it names one (the page
    // schema's default is Workspace, which for a plugin page means "with the plugin").
    for (const page of input.pages) {
      if ((page.origin !== `plugin:${plugin.slug}` && page.overrides !== `plugin:${plugin.slug}`) || page.nav.hidden) {
        continue;
      }
      claimedPages.push(page.slug);
      const label = page.nav.section && page.nav.section !== 'Workspace' ? page.nav.section : section;
      push(label, { title: page.title, url: page.href ?? `/dashboard/p/${page.slug}`, icon: page.icon ?? 'panels-top-left', plugin: plugin.slug, order: base + page.nav.order });
    }
    // The core routes it owns.
    for (const route of input.routes) {
      const owned = route.plugin === plugin.slug;
      const offered = !owned && route.offeredBy === plugin.slug;
      if (!owned && !offered) {
        continue;
      }
      if (owned) {
        claimedRoutes.push(route.url);
      }
      // An offered route is listed last and secondary: one row under "More ›",
      // never a pinned door — its own group keeps it for everyone else.
      push(section, { title: route.title, url: route.url, icon: route.iconName ?? 'folder-open', plugin: plugin.slug, order: offered ? base + 99 : base, ...(offered ? { secondary: true } : {}) });
    }
    // The surfaces it switches on.
    for (const id of plugin.surfaces) {
      const surface = (SURFACES as Record<string, { url: string; label: string; icon: string }>)[id];
      if (!surface) {
        continue;
      }
      claimedSurfaces.push(id);
      push(section, { title: surface.label, url: surface.url, icon: surface.icon, plugin: plugin.slug, order: base });
    }
  }

  return {
    sections: [...sections.entries()].map(([label, items]) => ({ label, items: items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)) })),
    claimedSurfaces,
    claimedPages,
    claimedRoutes,
  };
}
