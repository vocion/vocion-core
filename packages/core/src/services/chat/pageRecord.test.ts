import { describe, expect, it } from 'vitest';
import { recordLinksOf, recordTypeOfPage } from '@/libs/workspace/recordHref';
import { readPageContext, recordFromPath, withPageContext } from './pageContext';
import { typePageRecord } from './pageRecord';

// The factory plugin's pages, as far as the rule reads them: a report over
// requests, a list of releases with a record page, and the products board.
const MANIFESTS = [
  { slug: 'feature', archetype: 'report', report: { subject: 'request' } },
  { slug: 'releases', archetype: 'list', source: { kind: 'objects', objectType: 'release' }, recordPage: { actions: {} } },
  { slug: 'products', archetype: 'list', source: { kind: 'objects', objectType: 'product' }, derive: 'productBoard' },
  { slug: 'work', archetype: 'list', source: { kind: 'objects', objectType: 'request' } },
] as never[];
const LINKS = recordLinksOf(MANIFESTS, 'northwind');

describe('a page slug maps to the type its manifest opens, never to itself', () => {
  it('feature → request, releases → release, products → product; an unclaimed page is no type', () => {
    expect(recordTypeOfPage(LINKS, 'feature')).toBe('request');
    expect(recordTypeOfPage(LINKS, 'releases')).toBe('release');
    expect(recordTypeOfPage(LINKS, 'products')).toBe('product');
    expect(recordTypeOfPage(LINKS, 'work')).toBeNull();
    expect(recordTypeOfPage(LINKS, 'wiki')).toBeNull();
  });

  it('recordFromPath types a record page only through the map it is handed', () => {
    const pageType = (slug: string) => recordTypeOfPage(LINKS, slug);

    expect(recordFromPath('/w/northwind/dashboard/p/feature/124', 'Open alerts', pageType)).toEqual({ type: 'object', id: '124', label: 'Open alerts', href: '/dashboard/p/feature/124', objectType: 'request' });
    expect(recordFromPath('/w/northwind/dashboard/p/feature/124', 'Open alerts')).not.toHaveProperty('objectType');
    expect(recordFromPath('/dashboard/p/gallery/9', '', pageType)).not.toHaveProperty('objectType');
  });
});

describe('the page\'s record is typed before the turn (conversation 355: "`feature` isn\'t one of the object types I can read")', () => {
  const rows = new Map([[124, { typeSlug: 'request', title: 'Open alerts' }], [197, { typeSlug: 'release', title: 'Uploads that survive a bad connection' }]]);
  const deps = { links: async () => LINKS, row: async (id: number) => rows.get(id) ?? null };

  it('a feature page is its request, with the record\'s own title over the app\'s', async () => {
    const ctx = await typePageRecord(readPageContext({ path: '/w/northwind/dashboard/p/feature/124', title: 'Vocion Dashboard' }), deps);

    // …and by its code (no type declares one here: derived from the slug).
    expect(ctx?.record).toEqual({ type: 'object', id: '124', label: 'Open alerts', href: '/dashboard/p/feature/124', objectType: 'request', code: 'REQ-124' });
    // The model reads the type and id the tools take.
    expect(withPageContext('remove push notifications from scope', ctx)).toContain('This page is about REQ-124 "Open alerts" (/dashboard/p/feature/124) — objectType "request", id 124.');
  });

  it('a release page is its release; a registered record is typed too', async () => {
    expect((await typePageRecord(readPageContext({ path: '/w/northwind/dashboard/p/releases/197', title: 't' }), deps))?.record?.objectType).toBe('release');
    expect((await typePageRecord(readPageContext({ path: '/dashboard/p/releases/197', title: 't', record: { type: 'object', id: '197', href: '/dashboard/p/releases/197' } }), deps))?.record?.objectType).toBe('release');
  });

  it('with no row the manifest still says what the page opens; with neither nothing is invented', async () => {
    const noRows = { links: async () => LINKS, row: async () => null };

    expect((await typePageRecord(readPageContext({ path: '/dashboard/p/feature/555', title: 't' }), noRows))?.record?.objectType).toBe('request');
    expect((await typePageRecord(readPageContext({ path: '/dashboard/p/gallery/555', title: 't' }), noRows))?.record).not.toHaveProperty('objectType');
  });

  it('never fails the turn: a manifest or row read that throws leaves the ref as it was', async () => {
    const broken = {
      links: async () => {
        throw new Error('no pages');
      },
      row: async () => {
        throw new Error('db down');
      },
    };
    const ctx = await typePageRecord(readPageContext({ path: '/dashboard/p/feature/124', title: 't' }), broken);

    expect(ctx?.record).toMatchObject({ type: 'object', id: '124' });
    expect(ctx?.record).not.toHaveProperty('objectType');
  });

  it('keeps an objectType the client sent only in the slug shape, and only on an object', () => {
    expect(readPageContext({ path: '/x', title: 't', record: { type: 'object', id: '1', objectType: 'request' } })?.record?.objectType).toBe('request');
    expect(readPageContext({ path: '/x', title: 't', record: { type: 'object', id: '1', objectType: 'drop table;' } })?.record).not.toHaveProperty('objectType');
    expect(readPageContext({ path: '/x', title: 't', record: { type: 'deal', id: '1', objectType: 'request' } })?.record).not.toHaveProperty('objectType');
  });
});
