import { describe, expect, it } from 'vitest';
import { combinedPageTitle } from './combinedPages';
import {
  DASHBOARD_GROUPS,
  DASHBOARD_ROUTES,
  dashboardRoute,
  DEFAULT_WORK_PINS,
  manageNavGroups,
  manageRoutes,
  tabsOf,
  workCoreRoutes,
  workPinnableRoutes,
  workRoutes,
} from './dashboardNav';

/**
 * The registry is the one list the sidebar, the palette and the breadcrumb
 * derive from, so its shape IS the navigation. These pin the nav sweep of
 * 2026-09-15: reports and Developers out of WORK, five MANAGE sections in a
 * fixed order, tabs that stay real routes, Profile personal.
 */
describe('dashboardNav registry', () => {
  it('has unique urls and every route in a declared group', () => {
    const urls = DASHBOARD_ROUTES.map(r => r.url);

    expect(new Set(urls).size).toBe(urls.length);

    const groupIds = new Set(DASHBOARD_GROUPS.map(g => g.id));
    for (const r of DASHBOARD_ROUTES) {
      expect(groupIds.has(r.group)).toBe(true);
    }
  });

  it('keeps WORK to the daily driver — no reports, no developers, no configuration, and no second decision door', () => {
    const work = workRoutes().map(r => r.url);

    expect(work).toEqual(['/dashboard/chat', '/dashboard/inbox', '/dashboard/briefings', '/dashboard/artifacts', '/dashboard/search', '/dashboard/rooms']);
    // Chat and Review are the surface; the rest earn a row by being pinned, Briefings from the start.
    expect(workCoreRoutes().map(r => r.url)).toEqual(['/dashboard/chat', '/dashboard/inbox']);
    expect(workPinnableRoutes().map(r => r.url)).toEqual(['/dashboard/briefings', '/dashboard/artifacts', '/dashboard/search', '/dashboard/rooms']);
    expect(DEFAULT_WORK_PINS).toEqual(['/dashboard/briefings']);
    // Artifacts replaced Canvases, which never earned a row of its own.
    expect(DASHBOARD_ROUTES.some(r => r.url === '/dashboard/canvases')).toBe(false);
    expect(work).not.toContain('/dashboard/team-report');
    expect(work).not.toContain('/dashboard/activity');
    expect(work).not.toContain('/dashboard/developers');
    // Review folded into the review queue: no sidebar row, no route of its own.
    expect(work).not.toContain('/dashboard/review');
    expect(DASHBOARD_ROUTES.some(r => r.url === '/dashboard/review')).toBe(false);
  });

  it('keeps the review alias in the palette only — the muscle memory, not a second door', () => {
    const alias = DASHBOARD_ROUTES.find(r => r.paletteOnly)!;

    // The URL keeps `kind=proposal` — that is the stored kind, not a label —
    // while the row reads "Recommendations" (Chris, 2026-09-19: "Reviews should
    // not be proposals. 'Recommendation(s)' should probably be the term there").
    expect(alias).toMatchObject({ url: '/dashboard/inbox?kind=proposal', title: 'Review · Recommendations', group: 'Workspace' });
    expect(alias.keywords).toContain('review');
    expect(workRoutes().map(r => r.url)).not.toContain(alias.url);
    // It is a Workspace row, so it never reaches a MANAGE section or the pinnable list either.
    expect(manageRoutes(true).map(r => r.url)).not.toContain(alias.url);
  });

  it('derives the MANAGE sections in order, top-level rows only, tabs beneath their owner', () => {
    const sections = manageNavGroups(true);

    expect(sections.map(s => s.group.title)).toEqual(['Team', 'Knowledge', 'Build', 'Insights', 'Organization']);
    expect(sections.map(s => s.routes.map(r => r.url))).toEqual([
      ['/dashboard/teams', '/dashboard/missions', '/dashboard/workflows', '/dashboard/automation'],
      ['/dashboard/connectors', '/dashboard/objects', '/dashboard/learnings', '/dashboard/workspace'],
      ['/dashboard/skills', '/dashboard/evals', '/dashboard/marketplace'],
      ['/dashboard/team-report', '/dashboard/activity', '/dashboard/observability', '/dashboard/autonomy', '/dashboard/adoption'],
      ['/dashboard/members', '/dashboard/developers', '/api-docs', '/dashboard/admin'],
    ]);
    expect(tabsOf('/dashboard/teams').map(r => r.url)).toEqual(['/dashboard/teams', '/dashboard/agents']);
    expect(tabsOf('/dashboard/skills').map(r => r.url)).toEqual(['/dashboard/skills', '/dashboard/tools', '/dashboard/models']);
    expect(tabsOf('/dashboard/missions')).toEqual([]);
  });

  it('puts the Marketplace in Build, not in the Teams & agents tab strip', () => {
    const marketplace = dashboardRoute('/dashboard/marketplace')!;
    const build = manageNavGroups(true).find(s => s.group.id === 'Build')!;

    // Chris, 2026-09-18: the roster you have and the capability you could turn
    // on are different questions, so the catalogue left Teams & agents and the
    // separate Plugins row folded into it.
    expect(marketplace.group).toBe('Build');
    expect(marketplace.tabOf).toBeUndefined();
    // One sidebar row: the Agents-for-hire tab is a tab, not a second row.
    expect(build.routes.map(r => r.url)).toEqual(['/dashboard/skills', '/dashboard/evals', '/dashboard/marketplace']);
    expect(tabsOf('/dashboard/teams').map(r => r.url)).not.toContain('/dashboard/marketplace');
    expect(DASHBOARD_ROUTES.some(r => r.url === '/dashboard/plugins')).toBe(false);
    // It absorbed the Plugins row's words, so ⌘K "turn on wiki" still lands.
    expect(marketplace.keywords).toEqual(expect.arrayContaining(['plugin', 'plugins', 'install', 'turn on', 'wiki', 'data rooms', 'proposals']));
  });

  it('splits the Marketplace into Agents for hire and Plugins, with hiring on the owner URL', () => {
    // Chris, 2026-09-18: "Make Teams/Agents and Plugins tabs and/or sub-pages
    // for Marketplace." Two lists, two tabs, each its own registered route.
    expect(tabsOf('/dashboard/marketplace').map(r => r.url)).toEqual(['/dashboard/marketplace', '/dashboard/marketplace/plugins']);
    // Chris, 2026-09-20: "flip agents and plugins on these tabs" — hiring is
    // the commoner errand, so it owns the URL. Plugins keep a stable URL of
    // their own and the 308 from /dashboard/plugins points at it, so a pinned
    // entry and chat's "turn a plugin on" answer still land on plugins.
    expect(dashboardRoute('/dashboard/marketplace')?.tabTitle).toBe('Agents for hire');
    expect(dashboardRoute('/dashboard/marketplace/plugins')?.title).toBe('Plugins');
    // A tab, never a second sidebar row.
    expect(manageNavGroups(true).flatMap(s => s.routes.map(r => r.url))).not.toContain('/dashboard/marketplace/plugins');
    // …but still a pinnable destination and a breadcrumb owner.
    expect(manageRoutes(true).map(r => r.url)).toContain('/dashboard/marketplace/plugins');
    expect(combinedPageTitle('/dashboard/marketplace/plugins')).toBe('Plugins · Marketplace');
    expect(combinedPageTitle('/dashboard/marketplace')).toBe('Marketplace');
  });

  it('hides admin-only rows from members, in the sections and in the pinnable list', () => {
    const insights = manageNavGroups(false).find(s => s.group.id === 'Insights')!;

    expect(insights.routes.map(r => r.url)).not.toContain('/dashboard/adoption');
    expect(manageRoutes(false).map(r => r.url)).not.toContain('/dashboard/adoption');
    expect(manageRoutes(true).map(r => r.url)).toContain('/dashboard/adoption');
  });

  it('keeps a tab a real route in its owner’s group, so pins and deep links still resolve', () => {
    for (const tab of DASHBOARD_ROUTES.filter(r => r.tabOf)) {
      const owner = dashboardRoute(tab.tabOf!);

      expect(owner).toBeDefined();
      expect(owner!.group).toBe(tab.group);
      expect(owner!.tabOf).toBeUndefined();
    }

    // A pinned tab is a destination of its own — it is in the pinnable list …
    expect(manageRoutes(false).map(r => r.url)).toContain('/dashboard/agents');
    // … but not a row of its section.
    expect(manageNavGroups(false).flatMap(s => s.routes.map(r => r.url))).not.toContain('/dashboard/agents');
  });

  it('keeps Profile personal — never a MANAGE section', () => {
    expect(dashboardRoute('/dashboard/profile')?.group).toBe('You');
    expect(DASHBOARD_GROUPS.find(g => g.id === 'You')?.manage).toBe(false);
    expect(manageRoutes(true).map(r => r.url)).not.toContain('/dashboard/profile');
  });

  it('redirect targets are registered: the old credentials page lands on Developers', () => {
    expect(dashboardRoute('/dashboard/developers')?.group).toBe('Organization');
    expect(dashboardRoute('/dashboard/api-tokens')).toBeUndefined();
  });
});
