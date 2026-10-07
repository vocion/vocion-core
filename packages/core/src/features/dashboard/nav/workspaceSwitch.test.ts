import { describe, expect, it } from 'vitest';
import { countHiddenEmpty, crossAccountSlug, filterProjects, groupByAccount, isPersonalProject, projectAccent, shouldTriggerFindHotkey, slugLine, workspaceSwitchHref } from './workspaceSwitch';

const projects = [
  { id: 'p-default', slug: 'default', name: 'Default project', agentCount: 0 },
  { id: 'p-rev', slug: 'revenue', name: 'Revenue Team', agentCount: 10 },
  { id: 'p-ds', slug: 'delivery-stack', name: 'Delivery Stack', agentCount: 5 },
  { id: 'p-wf', slug: 'vocion-workforce', name: 'Vocion Workforce', agentCount: 14 },
];

describe('workspace switcher', () => {
  it('navigates through the /w/<slug> entry route for the same page, locale-aware', () => {
    expect(workspaceSwitchHref({ slug: 'revenue', pathname: '/dashboard/inbox', search: '?tab=open', locale: 'en', defaultLocale: 'en' }))
      .toBe('/w/revenue/dashboard/inbox?tab=open');
    expect(workspaceSwitchHref({ slug: 'Vocion-Workforce', pathname: '/dashboard/teams', locale: 'fr', defaultLocale: 'en' }))
      .toBe('/fr/w/vocion-workforce/dashboard/teams');
  });

  it('hides empty projects by default, keeps the active one, and searches name or slug', () => {
    expect(filterProjects(projects, {}).map(p => p.slug)).toEqual(['revenue', 'delivery-stack', 'vocion-workforce']);
    expect(filterProjects(projects, { activeId: 'p-default' }).map(p => p.slug)).toContain('default');
    expect(filterProjects(projects, { showEmpty: true })).toHaveLength(4);
    expect(filterProjects(projects, { query: 'stack' }).map(p => p.slug)).toEqual(['delivery-stack']);
    expect(filterProjects(projects, { query: 'WORK' }).map(p => p.slug)).toEqual(['vocion-workforce']);
    expect(countHiddenEmpty(projects)).toBe(1);
    expect(countHiddenEmpty(projects, 'p-default')).toBe(0);
  });

  // 5.0 screen capture: an app's picker hid the workspace that had just
  // installed the app, because it had no agents yet. Every workspace an app's
  // picker is handed has the app; none is hidden for being empty.
  it('in an app\'s picker, never hides a workspace for having no agents yet', () => {
    expect(filterProjects(projects, { keepEmpty: true }).map(p => p.slug)).toEqual(['default', 'revenue', 'delivery-stack', 'vocion-workforce']);
    expect(filterProjects(projects, { keepEmpty: true, query: 'default' }).map(p => p.slug)).toEqual(['default']);
    expect(countHiddenEmpty(projects, null, true)).toBe(0);
  });

  // The personal workspace's slug is a hash of the person's id — an address,
  // not a name — so the list shows "Personal" with no slug line.
  it('shows no slug for the person\'s own workspace, and does not search by it', () => {
    const personal = { id: 'p-mine', slug: 'personal-3f9a2c1b', name: 'Personal', agentCount: 1, kind: 'personal' as const };
    const shared = { ...projects[1]!, kind: 'shared' as const };

    expect(isPersonalProject(personal)).toBe(true);
    expect(isPersonalProject(shared)).toBe(false);
    expect(slugLine(personal)).toBeNull();
    expect(slugLine(shared)).toBe('revenue');
    expect(filterProjects([personal, shared], { query: '3f9a' })).toEqual([]);
    expect(filterProjects([personal, shared], { query: 'person' }).map(p => p.id)).toEqual(['p-mine']);
  });

  it('re-points a canonical path at the workspace being switched to, rather than nesting a second one', () => {
    // The switcher reads `usePathname()`, which now gives the app path — but a
    // caller handing it the canonical one must not produce `/w/a/w/b/…`, which
    // is the shape that used to 404 after a switch-and-refresh.
    expect(workspaceSwitchHref({ slug: 'delivery-stack', pathname: '/w/revenue/dashboard/objects/88201', locale: 'en', defaultLocale: 'en' }))
      .toBe('/w/delivery-stack/dashboard/objects/88201');
  });

  it('opens Find on a bare F only when nothing is being typed', () => {
    expect(shouldTriggerFindHotkey({ key: 'f', target: { tagName: 'BODY' } })).toBe(true);
    expect(shouldTriggerFindHotkey({ key: 'F', target: null })).toBe(true);
    expect(shouldTriggerFindHotkey({ key: 'f', target: { tagName: 'INPUT' } })).toBe(false);
    expect(shouldTriggerFindHotkey({ key: 'f', target: { tagName: 'TEXTAREA' } })).toBe(false);
    expect(shouldTriggerFindHotkey({ key: 'f', target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
    expect(shouldTriggerFindHotkey({ key: 'f', metaKey: true, target: { tagName: 'BODY' } })).toBe(false);
    expect(shouldTriggerFindHotkey({ key: 'f', defaultPrevented: true, target: { tagName: 'BODY' } })).toBe(false);
    expect(shouldTriggerFindHotkey({ key: 'g', target: { tagName: 'BODY' } })).toBe(false);
  });

  it('gives each slug a stable accent', () => {
    expect(projectAccent('revenue')).toBe(projectAccent('revenue'));
    expect(projectAccent('revenue')).toMatch(/^oklch\(/);
  });

  // vocion-core#128: a person in two accounts can hold the same slug in both.
  describe('across accounts', () => {
    const accounts = [
      { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
      { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
    ];
    const metactoSales = { id: 'p-m-sales', accountId: 'acct-metacto', slug: 'sales', name: 'Sales', agentCount: 2 };
    const contosoSales = { id: 'p-c-sales', accountId: 'acct-contoso', slug: 'sales', name: 'Sales', agentCount: 3 };
    const metactoOps = { id: 'p-m-ops', accountId: 'acct-metacto', slug: 'ops', name: 'Ops', agentCount: 1 };

    it('names the target account only when the switch leaves the current one', () => {
      expect(crossAccountSlug(contosoSales, 'acct-metacto', accounts)).toBe('contoso');
      expect(crossAccountSlug(metactoOps, 'acct-metacto', accounts)).toBeNull();
    });

    it('adds the account to the switch URL and keeps the rest of the query', () => {
      expect(workspaceSwitchHref({ slug: 'sales', pathname: '/dashboard/inbox', search: '?tab=open', locale: 'en', defaultLocale: 'en', accountSlug: 'contoso' }))
        .toBe('/w/sales/dashboard/inbox?tab=open&account=contoso');
    });

    it('drops an account left over from an earlier switch, so the next one resolves where the person now is', () => {
      expect(workspaceSwitchHref({ slug: 'ops', pathname: '/dashboard', search: '?account=contoso&tab=open', locale: 'en', defaultLocale: 'en', accountSlug: null }))
        .toBe('/w/ops/dashboard?tab=open');
    });

    it('groups the list under each account in membership order and leaves out an account with nothing visible', () => {
      const groups = groupByAccount([contosoSales, metactoSales, metactoOps], accounts);

      expect(groups.map(g => [g.account.name, g.projects.map(p => p.id)])).toEqual([
        ['Metacto', ['p-m-sales', 'p-m-ops']],
        ['Contoso', ['p-c-sales']],
      ]);
      expect(groupByAccount([metactoOps], accounts).map(g => g.account.name)).toEqual(['Metacto']);
    });
  });
});
