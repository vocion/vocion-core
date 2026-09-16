import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_GROUPS,
  DASHBOARD_ROUTES,
  dashboardRoute,
  manageNavGroups,
  manageRoutes,
  tabsOf,
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

    expect(work).toEqual(['/dashboard/chat', '/dashboard/inbox', '/dashboard/briefings', '/dashboard/artifacts', '/dashboard/search']);
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

    expect(alias).toMatchObject({ url: '/dashboard/inbox?kind=proposal', title: 'Review · Proposals', group: 'Workspace' });
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
      ['/dashboard/skills', '/dashboard/evals'],
      ['/dashboard/team-report', '/dashboard/activity', '/dashboard/observability', '/dashboard/autonomy', '/dashboard/adoption'],
      ['/dashboard/members', '/dashboard/developers', '/dashboard/admin'],
    ]);
    expect(tabsOf('/dashboard/teams').map(r => r.url)).toEqual(['/dashboard/teams', '/dashboard/agents']);
    expect(tabsOf('/dashboard/skills').map(r => r.url)).toEqual(['/dashboard/skills', '/dashboard/tools', '/dashboard/models']);
    expect(tabsOf('/dashboard/missions')).toEqual([]);
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
