import { describe, expect, it } from 'vitest';
import { dashboardRoute, manageNavGroups, routeVisible, workCoreRoutes, workPinnableRoutes } from './dashboardNav';

// Plugin-owned nav rows show only while their plugin is on; a caller with no
// plugin list in hand sees every row (nothing already running loses a door).

describe('plugin-owned routes', () => {
  const routines = dashboardRoute('/dashboard/automations')!;

  it('Automations belongs to the routines plugin', () => {
    expect(routines.plugin).toBe('routines');
  });

  it('hides while the plugin is off, shows while on, and ungated without a list', () => {
    expect(routeVisible(routines, { enabledPlugins: [] })).toBe(false);
    expect(routeVisible(routines, { enabledPlugins: ['routines'] })).toBe(true);
    expect(routeVisible(routines, {})).toBe(true);
  });

  it('the WORK pinnable rows follow the same gate', () => {
    expect(workPinnableRoutes({ enabledPlugins: [] }).map(r => r.url)).not.toContain('/dashboard/automations');
    expect(workPinnableRoutes({ enabledPlugins: ['routines'] }).map(r => r.url)).toContain('/dashboard/automations');
    expect(workPinnableRoutes().map(r => r.url)).toContain('/dashboard/automations');
  });

  it('Projects is a core noun: no plugin owns it, and it shows with no plugin on (2026-10-27)', () => {
    const projects = dashboardRoute('/dashboard/projects')!;

    expect(projects.plugin).toBeUndefined();
    expect(routeVisible(projects, { enabledPlugins: [] })).toBe(true);
    expect(workCoreRoutes({ enabledPlugins: [] }).map(r => r.url)).toContain('/dashboard/projects');
    expect(dashboardRoute('/dashboard/rooms')).toBeUndefined();
  });

  it('the plugin catalogue is Apps, a Build row for everyone; admin gating still holds', () => {
    const build = manageNavGroups({ isAdmin: false, enabledPlugins: [] }).find(g => g.group.id === 'Build')!;

    // The catalogue was the Marketplace's Plugins tab; it is Apps now, and
    // /dashboard/plugins and /dashboard/marketplace/plugins 308 there.
    expect(build.routes.map(r => r.url)).toContain('/dashboard/apps');
    expect(build.routes.map(r => r.url)).not.toContain('/dashboard/plugins');
    expect(dashboardRoute('/dashboard/apps')?.title).toBe('Apps');
    expect(manageNavGroups(false).find(g => g.group.id === 'Insights')!.routes.map(r => r.url)).not.toContain('/dashboard/adoption');
    expect(manageNavGroups(true).find(g => g.group.id === 'Insights')!.routes.map(r => r.url)).toContain('/dashboard/adoption');
  });
});
