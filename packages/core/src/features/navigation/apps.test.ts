import type { AppDefinition } from './apps';
import type { PluginNav } from './pluginNav';
import type { PluginManifest } from '@/libs/workspace/schemas';
import { describe, expect, it } from 'vitest';
import { defaultTint } from '@/libs/tints';
import { listApps } from '@/libs/workspace/apps';
import { listPlugins } from '@/libs/workspace/plugins';
import { appOwningPath, groupPluginsByApp, installedApps, resolveActiveApp, splitNavByApp, workspacesByApp, workspaceSwitchPath } from './apps';
import { DASHBOARD_ROUTES } from './dashboardNav';
import { pluginNav } from './pluginNav';

// Apps are read from their manifests; nothing here names a shipped app except
// the last block, which runs the real catalogue end to end.

function app(over: Partial<AppDefinition> & { id: string }): AppDefinition {
  return { name: over.id, icon: 'box', order: 10, core: false, hidden: false, plugins: [], surfaces: [], entry: `/dashboard/p/${over.id}`, nav: [], ...over };
}

const home = app({ id: 'home', core: true, order: 0, entry: '/dashboard/chat', nav: ['Workspace', 'Team'] });
const factory = app({ id: 'factory', order: 2, tint: 'peach', plugins: ['builder', 'watcher'], nav: ['Builder', 'Watch'], entry: '/dashboard/p/board' });
const sales = app({ id: 'sales', order: 3, plugins: ['deals', 'rooms'], surfaces: ['personalization', 'discovery'], nav: ['Sales'], entry: '/gtm/proposals' });
const later = app({ id: 'later', order: 1, hidden: true, plugins: ['builder'] });
const CATALOGUE = [sales, later, factory, home];

describe('installedApps', () => {
  it('always has the core app, and nothing else when nothing is on', () => {
    expect(installedApps([], [], CATALOGUE).map(a => a.id)).toEqual(['home']);
  });

  it('installs an app when any one of its plugins is on — a partial set is enough', () => {
    expect(installedApps(['watcher'], [], CATALOGUE).map(a => a.id)).toEqual(['home', 'factory']);
    expect(installedApps(['builder', 'watcher'], [], CATALOGUE).map(a => a.id)).toEqual(['home', 'factory']);
  });

  it('installs an app when one of its surfaces is on, with none of its plugins', () => {
    expect(installedApps([], ['discovery'], CATALOGUE).map(a => a.id)).toEqual(['home', 'sales']);
  });

  it('never installs a hidden app, even when its plugin is on', () => {
    expect(installedApps(['builder'], [], CATALOGUE).map(a => a.id)).not.toContain('later');
  });

  it('comes out in rail order whatever order the catalogue is in', () => {
    expect(installedApps(['deals', 'builder'], [], CATALOGUE).map(a => a.id)).toEqual(['home', 'factory', 'sales']);
  });

  it('ignores plugins and surfaces no app lists', () => {
    expect(installedApps(['wiki'], ['nope'], CATALOGUE).map(a => a.id)).toEqual(['home']);
  });
});

describe('workspacesByApp', () => {
  const workspaces = [
    { projectId: 'p-northwind', slug: 'northwind', name: 'Northwind', enabledPlugins: ['builder'], enabledSurfaces: [] },
    { projectId: 'p-kestrel', slug: 'kestrel', name: 'Kestrel Capital', enabledPlugins: ['rooms'], enabledSurfaces: [] },
    { projectId: 'p-acme', slug: 'acme', name: 'Acme', enabledPlugins: [], enabledSurfaces: [] },
  ];

  it('lists every workspace under the core app and only the ones with an app under it', () => {
    const r = workspacesByApp(workspaces, CATALOGUE);

    expect(r.workspacesByApp.home!.map(w => w.slug)).toEqual(['northwind', 'kestrel', 'acme']);
    expect(r.workspacesByApp.factory).toEqual([{ projectId: 'p-northwind', slug: 'northwind', name: 'Northwind' }]);
    expect(r.workspacesByApp.sales!.map(w => w.slug)).toEqual(['kestrel']);
    expect(r.workspacesByApp.later).toBeUndefined();
  });

  it('puts in the rail only the apps the person has somewhere, core first, with what the rail draws', () => {
    expect(workspacesByApp(workspaces, CATALOGUE).apps).toEqual([
      { id: 'home', name: 'home', icon: 'box', order: 0, core: true, entry: '/dashboard/chat', tint: defaultTint('home') },
      { id: 'factory', name: 'factory', icon: 'box', order: 2, core: false, entry: '/dashboard/p/board', tint: 'peach' },
      { id: 'sales', name: 'sales', icon: 'box', order: 3, core: false, entry: '/gtm/proposals', tint: defaultTint('sales') },
    ]);
    expect(workspacesByApp([workspaces[2]!], CATALOGUE).apps.map(a => a.id)).toEqual(['home']);
  });

  it('still has the core app, with no workspaces, for a person with none', () => {
    expect(workspacesByApp([], CATALOGUE)).toEqual({ apps: [expect.objectContaining({ id: 'home' })], workspacesByApp: { home: [] } });
  });
});

function nav(sections: PluginNav['sections'], claimed: Partial<PluginNav> = {}): PluginNav {
  return { sections, claimedSurfaces: [], claimedPages: [], claimedRoutes: [], ...claimed };
}

describe('splitNavByApp', () => {
  const routes = [{ url: '/dashboard/chat' }, { url: '/dashboard/rooms', plugin: 'rooms' }, { url: '/dashboard/team-report' }, { url: '/dashboard/evals' }];
  const installed = installedApps(['builder', 'watcher', 'rooms', 'deals', 'wiki'], ['discovery'], CATALOGUE);
  const split = splitNavByApp({
    apps: installed,
    nav: nav([
      { label: 'Workspace', items: [
        { title: 'Data rooms', url: '/dashboard/rooms', icon: 'folder-open', plugin: 'rooms', order: 0 },
        { title: 'Wiki', url: '/dashboard/p/wiki', icon: 'book-open', plugin: 'wiki', order: 5 },
      ] },
      { label: 'Builder', items: [
        { title: 'Board', url: '/dashboard/p/board', icon: 'layout-dashboard', plugin: 'builder', order: 1 },
        { title: 'Evals', url: '/dashboard/evals', icon: 'test-tube', plugin: 'builder', order: 99, secondary: true },
      ] },
      { label: 'Watch', items: [{ title: 'Incidents', url: '/dashboard/p/incidents', icon: 'siren', plugin: 'watcher', order: 1 }] },
      { label: 'Sales', items: [{ title: 'Team report', url: '/dashboard/team-report', icon: 'bar-chart-3', plugin: 'deals', order: 4 }] },
      { label: 'Ops', items: [{ title: 'Runbook', url: '/dashboard/p/runbook', icon: 'book-open', plugin: 'stray', order: 0 }] },
    ]),
    surfaces: ['discovery'],
    pages: [
      { title: 'Deal desk', url: '/dashboard/p/deal-desk', section: 'Sales' },
      { title: 'Hiring', url: '/dashboard/p/hiring', section: 'Pages' },
    ],
    coreRoutes: routes,
  });
  const byId = Object.fromEntries(split.apps.map(a => [a.id, a]));

  it('keeps for the core app only the rows no other app owns, in the shape the sidebar draws', () => {
    expect(split.core.nav.sections).toEqual([
      { label: 'Workspace', items: [{ title: 'Wiki', url: '/dashboard/p/wiki', icon: 'book-open', plugin: 'wiki', order: 5 }] },
      { label: 'Ops', items: [{ title: 'Runbook', url: '/dashboard/p/runbook', icon: 'book-open', plugin: 'stray', order: 0 }] },
    ]);
    expect(split.core.surfaces).toEqual([]);
    expect(split.core.pages).toEqual([{ title: 'Hiring', url: '/dashboard/p/hiring', section: 'Pages' }]);
  });

  it('gives an app its plugins\' sections, in the order its manifest names them', () => {
    expect(byId.factory!.sections).toEqual([
      { label: 'Builder', items: [
        { title: 'Board', url: '/dashboard/p/board', icon: 'layout-dashboard' },
        { title: 'Evals', url: '/dashboard/evals', icon: 'test-tube', secondary: true },
      ] },
      { label: 'Watch', items: [{ title: 'Incidents', url: '/dashboard/p/incidents', icon: 'siren' }] },
    ]);
  });

  it('puts a plugin row from the default section, a workspace page that joins the section and a listed surface inside the app', () => {
    expect(byId.sales!.sections).toEqual([
      { label: 'Sales', items: [
        { title: 'Data rooms', url: '/dashboard/rooms', icon: 'folder-open' },
        { title: 'Team report', url: '/dashboard/team-report', icon: 'bar-chart-3' },
        { title: 'Deal desk', url: '/dashboard/p/deal-desk', icon: 'panels-top-left' },
      ] },
      // A surface keeps the heading its registry gives it, inside the app that lists it.
      { label: 'GTM', items: [{ title: 'Discovery calls', url: '/gtm/discovery', icon: 'radar' }] },
    ]);
  });

  it('owns its pages, its surfaces and the core routes its plugins own — never a core route it only links to', () => {
    expect(byId.factory!.owns.sort()).toEqual(['/dashboard/p/board', '/dashboard/p/incidents']);
    expect(byId.sales!.owns.sort()).toEqual(['/dashboard/p/deal-desk', '/dashboard/rooms', '/gtm/discovery']);
    expect(byId.home!.owns).toEqual([]);
  });

  it('lands on the manifest entry when it is there, else on the app\'s first row', () => {
    expect(byId.factory!.href).toBe('/dashboard/p/board');
    expect(byId.sales!.href).toBe('/dashboard/rooms');
    expect(byId.home!.href).toBe('/dashboard/chat');
    expect(byId.home!.sections).toEqual([]);
  });

  it('with no apps installed beyond the core, changes nothing', () => {
    const input = nav([{ label: 'Workspace', items: [{ title: 'Wiki', url: '/dashboard/p/wiki', icon: 'book-open', plugin: 'wiki', order: 5 }] }]);
    const r = splitNavByApp({ apps: [home], nav: input, surfaces: ['discovery'], pages: [{ title: 'Hiring', url: '/dashboard/p/hiring', section: 'Sales' }], coreRoutes: routes });

    expect(r.core.nav).toEqual(input);
    expect(r.core.surfaces).toEqual(['discovery']);
    expect(r.core.pages).toHaveLength(1);
    expect(r.apps.map(a => a.id)).toEqual(['home']);
  });
});

describe('route → app', () => {
  const apps = [
    { id: 'home', core: true, owns: [] },
    { id: 'factory', core: false, owns: ['/dashboard/p/board', '/dashboard/p/board-archive'] },
    { id: 'sales', core: false, owns: ['/gtm/discovery', '/dashboard/rooms'] },
  ];

  it('maps an owned page and anything beneath it to its app, by whole path segments', () => {
    expect(appOwningPath('/dashboard/p/board', apps)).toBe('factory');
    expect(appOwningPath('/dashboard/rooms/r-42', apps)).toBe('sales');
    expect(appOwningPath('/dashboard/p/board-archive', apps)).toBe('factory');
    expect(appOwningPath('/dashboard/p/boardroom', apps)).toBeUndefined();
    expect(appOwningPath('/dashboard/chat', apps)).toBeUndefined();
  });

  it('lands a link or a refresh on an owned page in that app, whatever was remembered', () => {
    expect(resolveActiveApp({ pathname: '/gtm/discovery', apps, remembered: 'factory' })).toBe('sales');
  });

  it('keeps the remembered app on a shared page, while this workspace has it', () => {
    expect(resolveActiveApp({ pathname: '/dashboard/chat', apps, remembered: 'factory' })).toBe('factory');
    expect(resolveActiveApp({ pathname: '/dashboard/chat', apps, remembered: 'elsewhere' })).toBe('home');
    expect(resolveActiveApp({ pathname: '/dashboard/chat', apps, remembered: null })).toBe('home');
  });

  it('holds a rail pick of an app only another workspace has until the person moves', () => {
    const pick = { appId: 'elsewhere', path: '/dashboard/p/board' };

    expect(resolveActiveApp({ pathname: '/dashboard/p/board', apps, pick, known: ['home', 'factory', 'elsewhere'] })).toBe('elsewhere');
    expect(resolveActiveApp({ pathname: '/dashboard/chat', apps, pick, known: ['home', 'factory', 'elsewhere'] })).toBe('home');
    expect(resolveActiveApp({ pathname: '/dashboard/p/board', apps, pick, known: ['home'] })).toBe('factory');
  });
});

describe('workspaceSwitchPath', () => {
  const base = { pathname: '/dashboard/p/board', hereApps: ['home', 'factory'], appEntry: '/dashboard/p/board', coreEntry: '/dashboard/chat' };

  it('keeps the page when the target has the app', () => {
    expect(workspaceSwitchPath({ ...base, activeApp: 'factory', targetApps: ['home', 'factory'] })).toBe('/dashboard/p/board');
    expect(workspaceSwitchPath({ ...base, pathname: '/dashboard/teams', activeApp: 'home', targetApps: ['home'] })).toBe('/dashboard/teams');
  });

  it('falls back to the core app when the target does not have the app', () => {
    expect(workspaceSwitchPath({ ...base, activeApp: 'factory', targetApps: ['home'] })).toBe('/dashboard/chat');
  });

  it('opens the app\'s entry when the person picked an app this workspace lacks', () => {
    expect(workspaceSwitchPath({ ...base, pathname: '/dashboard/teams', activeApp: 'sales', appEntry: '/gtm/proposals', targetApps: ['home', 'sales'] })).toBe('/gtm/proposals');
  });
});

describe('groupPluginsByApp', () => {
  it('gives each app its plugins and the core app the rest; hidden and empty apps drop out', () => {
    const groups = groupPluginsByApp(['builder', 'deals', 'rooms', 'watcher', 'wiki'], CATALOGUE);

    expect(groups.map(g => [g.app.id, g.plugins])).toEqual([
      ['home', ['wiki']],
      ['factory', ['builder', 'watcher']],
      ['sales', ['deals', 'rooms']],
    ]);
    expect(groupPluginsByApp(['wiki'], CATALOGUE).map(g => g.app.id)).toEqual(['home']);
  });
});

describe('the shipped apps over the shipped plugins', () => {
  const apps = listApps();
  const plugins = listPlugins();
  const manifests = (slugs: string[]): PluginManifest[] => plugins.filter(p => slugs.includes(p.manifest.slug)).map(p => p.manifest);
  const pages = [
    { slug: 'products', title: 'Products', nav: { section: 'Software factory', order: 1, hidden: false }, origin: 'plugin:software-factory' },
    { slug: 'incidents', title: 'Incidents', nav: { section: 'Production Watch', order: 1, hidden: false }, origin: 'plugin:production-watch' },
    { slug: 'wiki', title: 'Wiki', nav: { section: 'Workspace', order: 5, hidden: false }, origin: 'plugin:wiki' },
  ];

  it('every plugin section is owned by the app that lists the plugin, so no app row falls back to Workforce', () => {
    for (const a of apps.filter(x => !x.core)) {
      for (const p of manifests(a.plugins)) {
        if (p.nav.section !== 'Workspace') {
          expect(a.nav, `${a.id} should own ${p.slug}'s section "${p.nav.section}"`).toContain(p.nav.section);
        }
      }
    }
  });

  it('a factory workspace with the wiki: the factory\'s rows in its app, the wiki with Workforce', () => {
    const enabled = ['software-factory', 'production-watch', 'wiki'];
    const installed = installedApps(enabled, [], apps);
    const split = splitNavByApp({ apps: installed, nav: pluginNav({ plugins: manifests(enabled), pages, routes: DASHBOARD_ROUTES }), surfaces: [], pages: [], coreRoutes: DASHBOARD_ROUTES });
    const factoryApp = split.apps.find(a => !a.core)!;

    expect(installed.filter(a => !a.core)).toHaveLength(1);
    expect(factoryApp.sections.flatMap(s => s.items.map(i => i.url))).toEqual(expect.arrayContaining(['/dashboard/p/products', '/dashboard/p/incidents']));
    expect(split.core.nav.sections.flatMap(s => s.items.map(i => i.url))).toEqual(['/dashboard/p/wiki']);
    expect(appOwningPath('/dashboard/p/incidents', split.apps)).toBe(factoryApp.id);
    // Evals is offered by the factory, not owned: the route stays Workforce's.
    expect(appOwningPath('/dashboard/evals', split.apps)).toBeUndefined();
  });

  it('a workspace with only Data rooms on has the app that lists it, which owns the rooms route', () => {
    const installed = installedApps(['data-rooms'], [], apps);
    const split = splitNavByApp({ apps: installed, nav: pluginNav({ plugins: manifests(['data-rooms']), pages: [], routes: DASHBOARD_ROUTES }), surfaces: [], pages: [], coreRoutes: DASHBOARD_ROUTES });
    const owner = split.apps.find(a => !a.core)!;

    expect(apps.find(a => a.id === owner.id)!.plugins).toContain('data-rooms');
    expect(appOwningPath('/dashboard/rooms/r-1', split.apps)).toBe(owner.id);
    expect(owner.href).toBe('/dashboard/rooms');
  });
});
