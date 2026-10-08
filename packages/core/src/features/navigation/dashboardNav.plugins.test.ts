import { describe, expect, it } from 'vitest';
import { dashboardRoute, manageNavGroups, routeVisible, workPinnableRoutes } from './dashboardNav';

// Plugin-owned nav rows show only while their plugin is on; a caller with no
// plugin list in hand sees every row (nothing already running loses a door).

describe('plugin-owned routes', () => {
  const rooms = dashboardRoute('/dashboard/rooms')!;

  it('Data rooms belongs to the data-rooms plugin', () => {
    expect(rooms.plugin).toBe('data-rooms');
  });

  it('hides while the plugin is off, shows while on, and ungated without a list', () => {
    expect(routeVisible(rooms, { enabledPlugins: [] })).toBe(false);
    expect(routeVisible(rooms, { enabledPlugins: ['data-rooms'] })).toBe(true);
    expect(routeVisible(rooms, {})).toBe(true);
  });

  it('the WORK pinnable rows follow the same gate', () => {
    expect(workPinnableRoutes({ enabledPlugins: [] }).map(r => r.url)).not.toContain('/dashboard/rooms');
    expect(workPinnableRoutes({ enabledPlugins: ['data-rooms'] }).map(r => r.url)).toContain('/dashboard/rooms');
    expect(workPinnableRoutes().map(r => r.url)).toContain('/dashboard/rooms');
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
