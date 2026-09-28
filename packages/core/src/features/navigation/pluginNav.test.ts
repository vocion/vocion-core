import type { PluginManifest } from '@/libs/workspace/schemas';
import { describe, expect, it } from 'vitest';
import { pluginNav } from './pluginNav';

// One plugin.yaml `nav.section` decides where a plugin's pages, owned core
// routes and surfaces all sit — Workspace by default, a named app otherwise.

function plugin(over: Partial<PluginManifest> & { slug: string }): PluginManifest {
  return {
    name: over.slug,
    version: '1.0.0',
    description: 'test',
    depends: [],
    surfaces: [],
    nav: { section: 'Workspace', order: 0 },
    recommend: { when: [], connectors: [] },
    ...over,
  };
}

const routes = [
  { url: '/dashboard/chat', title: 'Chat' },
  { url: '/dashboard/rooms', title: 'Data rooms', plugin: 'data-rooms' },
];

describe('pluginNav', () => {
  it('puts a plugin\'s page and its owned route together in Workspace by default, and claims both', () => {
    const nav = pluginNav({
      plugins: [plugin({ slug: 'wiki' }), plugin({ slug: 'data-rooms' })],
      pages: [{ slug: 'wiki', title: 'Wiki', icon: 'book-open', nav: { section: 'Workspace', order: 5, hidden: false }, origin: 'plugin:wiki' }, { slug: 'wiki-guide', title: 'Guide', nav: { section: 'Workspace', order: 6, hidden: true }, origin: 'plugin:wiki' }],
      routes,
    });

    expect(nav.sections).toEqual([{ label: 'Workspace', items: [
      { title: 'Data rooms', url: '/dashboard/rooms', icon: 'folder-open', plugin: 'data-rooms', order: 0 },
      { title: 'Wiki', url: '/dashboard/p/wiki', icon: 'book-open', plugin: 'wiki', order: 5 },
    ] }]);
    expect(nav.claimedPages).toEqual(['wiki']);
    expect(nav.claimedRoutes).toEqual(['/dashboard/rooms']);
    expect(nav.claimedSurfaces).toEqual([]);
  });

  it('a plugin in a named app takes its surface with it, and the surface is claimed', () => {
    const nav = pluginNav({
      plugins: [plugin({ slug: 'proposals', surfaces: ['proposals'], nav: { section: 'GTM', order: 0 } })],
      pages: [],
      routes,
    });

    expect(nav.sections).toEqual([{ label: 'GTM', items: [{ title: 'Proposals', url: '/gtm/proposals', icon: 'file-text', plugin: 'proposals', order: 0 }] }]);
    expect(nav.claimedSurfaces).toEqual(['proposals']);
  });

  it('a page that names its own section goes there; a workspace page is never claimed', () => {
    const nav = pluginNav({
      plugins: [plugin({ slug: 'wiki' })],
      pages: [
        { slug: 'wiki', title: 'Wiki', nav: { section: 'Knowledge', order: 0, hidden: false }, origin: 'plugin:wiki' },
        { slug: 'mine', title: 'Mine', nav: { section: 'Workspace', order: 0, hidden: false }, origin: 'workspace' },
      ],
      routes,
    });

    expect(nav.sections.map(s => s.label)).toEqual(['Knowledge']);
    expect(nav.claimedPages).toEqual(['wiki']);
  });

  it('a link page is a row for its href, in the plugin\'s section, and is claimed like any page', () => {
    const nav = pluginNav({
      plugins: [plugin({ slug: 'software-factory' })],
      pages: [{ slug: 'team-report', title: 'Team report', icon: 'bar-chart-3', nav: { section: 'Software factory', order: 9, hidden: false }, origin: 'plugin:software-factory', href: '/dashboard/team-report' }],
      routes,
    });

    expect(nav.sections).toEqual([{ label: 'Software factory', items: [{ title: 'Team report', url: '/dashboard/team-report', icon: 'bar-chart-3', plugin: 'software-factory', order: 9 }] }]);
    expect(nav.claimedPages).toEqual(['team-report']);
  });

  it('a core route a plugin OFFERS lists last and secondary in its section, and is not claimed — its own group keeps it', () => {
    const nav = pluginNav({
      plugins: [plugin({ slug: 'software-factory', nav: { section: 'Software factory', order: 0 } })],
      pages: [],
      routes: [...routes, { url: '/dashboard/evals', title: 'Evals', offeredBy: 'software-factory' }],
    });

    expect(nav.sections).toEqual([{ label: 'Software factory', items: [{ title: 'Evals', url: '/dashboard/evals', icon: 'folder-open', plugin: 'software-factory', order: 99, secondary: true }] }]);
    expect(nav.claimedRoutes).toEqual([]);
  });

  it('nothing enabled, nothing claimed', () => {
    expect(pluginNav({ plugins: [], pages: [], routes })).toEqual({ sections: [], claimedSurfaces: [], claimedPages: [], claimedRoutes: [] });
  });
});
