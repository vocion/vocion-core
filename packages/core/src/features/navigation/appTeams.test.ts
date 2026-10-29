import type { AppDefinition } from './apps';
import { describe, expect, it } from 'vitest';
import { listApps } from '@/libs/workspace/apps';
import { listPlugins, pluginContents } from '@/libs/workspace/plugins';
import { appOfTeam, teamsOfApp } from './appTeams';

// Apps and plugins are read from their manifests; nothing here names a
// shipped app except the last block, which runs the real catalogue.

function app(over: Partial<AppDefinition> & { id: string }): AppDefinition {
  return { name: over.id, icon: 'box', order: 10, core: false, hidden: false, plugins: [], surfaces: [], entry: `/dashboard/p/${over.id}`, nav: [], ...over };
}

const home = app({ id: 'home', core: true, order: 0 });
const sales = app({ id: 'sales', plugins: ['deals', 'followups'] });
const ads = app({ id: 'ads', plugins: ['paid'] });
const apps = [home, sales, ads];
const pluginTeams = { deals: ['deals'], followups: ['followups'], paid: ['paid-search'] };

describe('appOfTeam', () => {
  it('puts a team a plugin ships in the app that lists the plugin', () => {
    expect(appOfTeam({ slug: 'followups', app: null }, { apps, pluginTeams })).toBe('sales');
    expect(appOfTeam({ slug: 'paid-search', app: null }, { apps, pluginTeams })).toBe('ads');
  });

  it('puts a workspace team in the app its file names', () => {
    expect(appOfTeam({ slug: 'pipeline', app: 'sales' }, { apps, pluginTeams })).toBe('sales');
  });

  it('lets a file move a plugin team to another app', () => {
    expect(appOfTeam({ slug: 'paid-search', app: 'sales' }, { apps, pluginTeams })).toBe('sales');
  });

  it('keeps a workspace team that names no app with the core app', () => {
    expect(appOfTeam({ slug: 'pipeline', app: null }, { apps, pluginTeams })).toBe('home');
  });

  it('reads an app the catalogue does not have as no app named', () => {
    expect(appOfTeam({ slug: 'pipeline', app: 'retired' }, { apps, pluginTeams })).toBe('home');
    expect(appOfTeam({ slug: 'deals', app: 'retired' }, { apps, pluginTeams })).toBe('sales');
  });
});

describe('teamsOfApp', () => {
  const teams = [
    { slug: 'pipeline', app: 'sales' },
    { slug: 'deals', app: null },
    { slug: 'paid-search', app: null },
    { slug: 'wiki', app: null },
  ];

  it('gives each app its own teams, and the rest to the core app', () => {
    expect(teamsOfApp('sales', teams, { apps, pluginTeams })).toEqual(['pipeline', 'deals']);
    expect(teamsOfApp('ads', teams, { apps, pluginTeams })).toEqual(['paid-search']);
    expect(teamsOfApp('home', teams, { apps, pluginTeams })).toEqual(['wiki']);
  });
});

describe('the shipped catalogue', () => {
  it('puts every team a member plugin ships in that app, and no team in two apps', () => {
    const catalogue = listApps();
    const shipped = Object.fromEntries(listPlugins().map(p => [p.manifest.slug, pluginContents(p).teams]));
    for (const a of catalogue.filter(x => !x.core)) {
      for (const plugin of a.plugins) {
        for (const team of shipped[plugin] ?? []) {
          expect(appOfTeam({ slug: team, app: null }, { apps: catalogue, pluginTeams: shipped })).toBe(a.id);
        }
      }
    }
  });
});
