import { describe, expect, it } from 'vitest';
import { countHiddenEmpty, filterProjects, projectAccent, shouldTriggerFindHotkey, workspaceSwitchHref } from './workspaceSwitch';

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
});
