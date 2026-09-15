import { describe, expect, it } from 'vitest';
import { DASHBOARD_GROUPS, DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { buildPaletteGroups, ROUTE_GROUP_ORDER } from './paletteGroups';

describe('buildPaletteGroups', () => {
  it('leads with Ask when the query is free text, and hides it when empty', () => {
    const withQuery = buildPaletteGroups({ query: 'why is spinutech stale', routes: DASHBOARD_ROUTES, isAdmin: false });

    expect(withQuery[0]?.heading).toBe('Ask');
    expect(withQuery[0]?.rows[0]?.label).toBe('Ask Vocion: why is spinutech stale');
    expect(withQuery[0]?.rows[0]?.action).toBe('ask');

    const empty = buildPaletteGroups({ query: '   ', routes: DASHBOARD_ROUTES, isAdmin: false });

    expect(empty[0]?.heading).toBe('Workspace');
    expect(empty.at(-1)?.rows.some(r => r.label === 'Ask Vocion')).toBe(true);
  });

  it('orders page headings the way the registry does — the sidebar’s MANAGE sections, then You', () => {
    expect(ROUTE_GROUP_ORDER).toEqual(DASHBOARD_GROUPS.map(g => g.title));

    const headings = buildPaletteGroups({ query: '', routes: DASHBOARD_ROUTES, isAdmin: true }).map(g => g.heading);

    expect(headings.slice(0, 7)).toEqual(['Workspace', 'Team', 'Knowledge', 'Build', 'Insights', 'Organization', 'You']);
    expect(headings).not.toContain('Observability');
  });

  it('keeps Profile findable under You, and names a tab after its page', () => {
    const groups = buildPaletteGroups({ query: '', routes: DASHBOARD_ROUTES, isAdmin: false });
    const by = (h: string) => groups.find(g => g.heading === h);

    expect(by('You')?.rows.map(r => r.url)).toEqual(['/dashboard/profile']);
    expect(by('Organization')?.rows.map(r => r.url)).not.toContain('/dashboard/profile');

    const agents = by('Team')?.rows.find(r => r.url === '/dashboard/agents');

    expect(agents?.hint).toBe('Teams & agents');
    expect(by('Team')?.rows.find(r => r.url === '/dashboard/teams')?.hint).toBeUndefined();
  });

  it('hides admin-only routes for non-admins', () => {
    const rows = buildPaletteGroups({ query: '', routes: DASHBOARD_ROUTES, isAdmin: false }).flatMap(g => g.rows);
    const adminRows = buildPaletteGroups({ query: '', routes: DASHBOARD_ROUTES, isAdmin: true }).flatMap(g => g.rows);

    expect(rows.some(r => r.url === '/dashboard/adoption')).toBe(false);
    expect(adminRows.some(r => r.url === '/dashboard/adoption')).toBe(true);
  });

  it('adds agents, teams, missions and the last eight conversations as link rows', () => {
    const groups = buildPaletteGroups({
      query: '',
      routes: DASHBOARD_ROUTES,
      isAdmin: false,
      agents: [{ slug: 'revenue-lead', name: 'RevOps Lead' }],
      teams: [{ slug: 'revops', name: 'RevOps' }],
      missions: [{ slug: 'daily-revenue-briefing', name: 'Revenue Briefing' }],
      conversations: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `Thread ${i + 1}`, agentSlug: 'ceo' })),
    });
    const by = (h: string) => groups.find(g => g.heading === h);

    expect(by('Agents')?.rows[0]?.url).toBe('/dashboard/agents/revenue-lead');
    expect(by('Teams')?.rows[0]?.url).toBe('/dashboard/teams/revops');
    expect(by('Missions')?.rows[0]?.url).toBe('/dashboard/missions/daily-revenue-briefing');
    expect(by('Recent conversations')?.rows).toHaveLength(8);
    expect(by('Recent conversations')?.rows[0]?.url).toBe('/dashboard/chat?conversation=1&agent=ceo');
  });

  it('names the theme command after the theme it switches to', () => {
    const dark = buildPaletteGroups({ query: '', routes: [], isAdmin: false, themeIsDark: true }).at(-1)!.rows;
    const light = buildPaletteGroups({ query: '', routes: [], isAdmin: false, themeIsDark: false }).at(-1)!.rows;

    expect(dark.find(r => r.action === 'toggle-theme')?.label).toBe('Switch to light theme');
    expect(light.find(r => r.action === 'toggle-theme')?.label).toBe('Switch to dark theme');
  });
});
