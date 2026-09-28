import { describe, expect, it } from 'vitest';
import { readWorkspacePages } from './pages';
import { NO_RECORD_PAGES, rawRecordHrefFrom, recordHrefFrom, recordLinksOf, recordPagesOf } from './recordHref';

/**
 * One link for every record: a record opens the page its workspace declares
 * for its type, and the generic record view only when none does.
 */

const factoryPages = () => readWorkspacePages({ enabledPlugins: ['software-factory'], mounted: false }).pages;

describe('recordHref', () => {
  it('opens a declared type at the plugin page the software factory ships for it', () => {
    const links = recordLinksOf(factoryPages());

    expect(recordHrefFrom(links, { objectType: 'release', id: 12 })).toBe('/dashboard/p/releases/12');
    expect(recordHrefFrom(links, { objectType: 'request', id: 41 })).toBe('/dashboard/p/feature/41');
    expect(recordHrefFrom(links, { objectType: 'product', id: 3 })).toBe('/dashboard/p/products/3');
  });

  it('falls back to the generic record for a type no page claims, and for no type at all', () => {
    const links = recordLinksOf(factoryPages());

    expect(recordHrefFrom(links, { objectType: 'engineering_task', id: 52 })).toBe('/dashboard/objects/52');
    expect(recordHrefFrom(links, { objectType: null, id: 52 })).toBe('/dashboard/objects/52');
    expect(recordHrefFrom(NO_RECORD_PAGES, { objectType: 'release', id: 12 })).toBe('/dashboard/objects/12');
  });

  it('prefixes the workspace, on the page link and on the raw record alike', () => {
    const links = recordLinksOf(factoryPages(), 'Northwind');

    expect(recordHrefFrom(links, { objectType: 'release', id: 12 })).toBe('/w/northwind/dashboard/p/releases/12');
    expect(recordHrefFrom(links, { objectType: 'engineering_task', id: 52 })).toBe('/w/northwind/dashboard/objects/52');
    expect(rawRecordHrefFrom(links, 12)).toBe('/w/northwind/dashboard/objects/12');
  });

  it('takes only pages the record route draws: a rowLink alone is not a claim, and the first claim wins', () => {
    const pages = recordPagesOf([
      // A list whose rows point at a page path the record route does not draw.
      { slug: 'growth-briefs', archetype: 'list', source: { kind: 'objects', objectType: 'brief' }, rowLink: '/dashboard/p/growth-briefs/{id}' },
      // A workspace override, read before the plugin's page for the same type.
      { slug: 'ship-log', archetype: 'list', source: { kind: 'objects', objectType: 'release' }, recordPage: { kind: 'release', actions: {} } },
      { slug: 'releases', archetype: 'list', source: { kind: 'objects', objectType: 'release' }, recordPage: { kind: 'release', actions: {} } },
    ] as never);

    expect(pages.get('brief')).toBeUndefined();
    expect(pages.get('release')).toBe('/dashboard/p/ship-log/{id}');
  });
});
