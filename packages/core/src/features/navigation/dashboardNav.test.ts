import { describe, expect, it } from 'vitest';
import { combinedPageTitle } from './combinedPages';
import {
  DASHBOARD_GROUPS,
  DASHBOARD_ROUTES,
  dashboardRoute,
  DEFAULT_WORK_PINS,
  manageNavGroups,
  manageRoutes,
  routeVisible,
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

    // The one report in WORK is the client scorecard (#342): the view a
    // business user opens on their own, so it must not sit under MANAGE.
    // Automations is the one configuration row in WORK, under More (Chris,
    // 2026-10-01: "Make it on main nav under More dropdown").
    expect(work).toEqual(['/dashboard/chat', '/dashboard/inbox', '/dashboard/briefings', '/dashboard/artifacts', '/dashboard/scorecard', '/dashboard/search', '/dashboard/rooms']);
    // Chat and Review are the surface; the rest earn a row by being pinned, Briefings and the Scorecard from the start.
    expect(workCoreRoutes().map(r => r.url)).toEqual(['/dashboard/chat', '/dashboard/inbox']);
    expect(workPinnableRoutes().map(r => r.url)).toEqual(['/dashboard/briefings', '/dashboard/artifacts', '/dashboard/scorecard', '/dashboard/search', '/dashboard/rooms']);
    expect(DEFAULT_WORK_PINS).toEqual(['/dashboard/briefings', '/dashboard/scorecard']);
    // Artifacts replaced Canvases, which never earned a row of its own.
    expect(DASHBOARD_ROUTES.some(r => r.url === '/dashboard/canvases')).toBe(false);
    expect(work).not.toContain('/dashboard/team-report');
    expect(work).not.toContain('/dashboard/activity');
    expect(work).not.toContain('/dashboard/developers');
    // Review folded into the review queue: no sidebar row, no route of its own.
    expect(work).not.toContain('/dashboard/review');
    expect(DASHBOARD_ROUTES.some(r => r.url === '/dashboard/review')).toBe(false);
  });

  it('offers the scorecard to a non-admin member, while Adoption stays admin-only (#342)', () => {
    const memberWork = workRoutes({ isAdmin: false }).map(r => r.url);
    const scorecard = DASHBOARD_ROUTES.find(r => r.url === '/dashboard/scorecard');
    const adoption = DASHBOARD_ROUTES.find(r => r.url === '/dashboard/adoption');

    expect(memberWork).toContain('/dashboard/scorecard');
    expect(scorecard && routeVisible(scorecard, { isAdmin: false })).toBe(true);
    expect(adoption && routeVisible(adoption, { isAdmin: false })).toBe(false);
    // Client-facing label: "Evals" is an engineering word.
    expect(scorecard?.title).not.toMatch(/eval/i);
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
      ['/dashboard/skills', '/dashboard/evals', '/dashboard/apps'],
      ['/dashboard/team-report', '/dashboard/activity', '/dashboard/observability', '/dashboard/autonomy', '/dashboard/adoption'],
      ['/dashboard/members', '/dashboard/developers', '/api-docs', '/dashboard/admin'],
    ]);
    expect(tabsOf('/dashboard/teams').map(r => r.url)).toEqual(['/dashboard/teams', '/dashboard/agents', '/dashboard/hire']);
    expect(tabsOf('/dashboard/skills').map(r => r.url)).toEqual(['/dashboard/skills', '/dashboard/tools', '/dashboard/models']);
    expect(tabsOf('/dashboard/missions')).toEqual([]);
  });

  it('puts Apps in Build as one row, where "+ Add app" lands', () => {
    const apps = dashboardRoute('/dashboard/apps')!;
    const build = manageNavGroups(true).find(s => s.group.id === 'Build')!;

    // Chris, 2026-10-08: the rail's "+ Add app" opens Apps — one card per app,
    // each app's features on its own page. It replaced the Marketplace's
    // Plugins tab, so the old paths are redirects, not rows.
    expect(apps.group).toBe('Build');
    expect(apps.tabOf).toBeUndefined();
    expect(build.routes.map(r => r.url)).toEqual(['/dashboard/skills', '/dashboard/evals', '/dashboard/apps']);
    expect(DASHBOARD_ROUTES.some(r => r.url === '/dashboard/plugins' || r.url.startsWith('/dashboard/marketplace'))).toBe(false);
    // It kept the plugin catalogue's words, so ⌘K "turn on wiki" still lands.
    expect(apps.keywords).toEqual(expect.arrayContaining(['plugin', 'plugins', 'feature', 'install', 'turn on', 'wiki', 'data rooms', 'proposals', 'marketplace']));
  });

  it('puts Hire an agent in Workforce, a tab of Teams & agents beside the agents you have', () => {
    // Chris, 2026-10-08: agents for hire left the marketplace for Workforce.
    const hire = dashboardRoute('/dashboard/hire')!;

    expect(hire.title).toBe('Hire an agent');
    expect(hire.tabOf).toBe('/dashboard/teams');
    expect(hire.keywords).toEqual(expect.arrayContaining(['hire', 'agents for hire', 'marketplace']));
    // A tab, never a second sidebar row…
    expect(manageNavGroups(true).flatMap(s => s.routes.map(r => r.url))).not.toContain('/dashboard/hire');
    // …but still a pinnable destination with its page in the title.
    expect(manageRoutes(true).map(r => r.url)).toContain('/dashboard/hire');
    expect(combinedPageTitle('/dashboard/hire')).toBe('Hire an agent · Teams & agents');
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
