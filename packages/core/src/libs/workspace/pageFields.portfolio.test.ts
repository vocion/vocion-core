import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { describe, expect, it } from 'vitest';
import { emptyFields, fieldHasSource, fieldIsEmptyOn, fieldIsFresh, PageManifestSchema, tableLayout } from '@/libs/workspace/pageFields';

/**
 * The page-layer rules the Products board is built on, asserted over the two
 * products that actually exist so a change to them is a failing test rather
 * than a screenshot somebody notices later.
 *
 * Three rules, all of them general and none of them about products:
 *
 * 1. A field no row can fill is removed, not drawn blank. An empty revenue
 *    column does not report that revenue is zero; it advertises, once per
 *    row, that revenue was never built.
 * 2. A value and the absence of a feed are different facts. A product whose
 *    monitor says `degraded` is in trouble; a product nothing monitors is one
 *    we have not wired up, and calling both "unknown" blames the product for
 *    our own gap.
 * 3. Freshness is only news once it stops being fresh, so a stamp drawn on
 *    every row while everything is current is the machinery reporting that it
 *    ran.
 */

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return {
    label: over.key,
    format: 'text',
    total: false,
    priority: 1,
    hideWhenConstant: false,
    hideWhenEmpty: true,
    ...over,
  } as PageField;
}

const NOW = new Date('2026-09-21T18:00:00Z').getTime();

/** Send, in dogfood, priced, watched, with work open. */
const SEND: PageRow = {
  id: 25,
  title: 'Send',
  status: 'active',
  createdAt: new Date('2026-09-20T22:38:17Z'),
  meta: {
    stage: 'dogfood',
    health: 'ok',
    healthSource: 'deploy check',
    healthCheckedAt: '2026-09-21T14:40:00.000Z',
    ourPrice: '$15/mo per seat, $150/yr',
    incumbent: { name: 'DocSend by Dropbox', listPrice: '$30/user/mo', checkedOn: '2026-09-19' },
    accountableUser: 'chris@metacto.com',
    lastShipped: 'The document page has one Share button.',
    lastReleaseAt: '2026-09-21T14:37:07.062Z',
    openRequests: 3,
    inFlight: 1,
    p1Open: 0,
    countersUpdatedAt: '2026-09-21T11:00:00.000Z',
  },
};

/** Slate, live, owned by Garrett, nothing watching it and no price recorded. */
const SLATE: PageRow = {
  id: 26,
  title: 'Slate',
  status: 'active',
  createdAt: new Date('2026-09-20T22:38:17Z'),
  meta: {
    stage: 'live',
    incumbent: { name: 'Loom' },
    accountableUser: 'garrett@metacto.com',
  },
};

const REVENUE = field({ key: 'revenue', label: 'Revenue', from: 'meta.revenueMonthCents', format: 'money' });
const HEALTH = field({
  key: 'health',
  label: 'Health',
  from: 'meta.health',
  format: 'badge',
  source: { from: ['meta.healthSource', 'meta.healthCheckedAt'], absentLabel: 'monitoring not connected' },
});
const PRICE = field({
  key: 'price',
  label: 'Our price',
  from: 'meta.ourPrice',
  format: 'compare',
  beside: { from: 'meta.incumbent.listPrice', labelFrom: 'meta.incumbent.name', checkedFrom: 'meta.incumbent.checkedOn' },
});
const STAMP = field({ key: 'updated', label: 'Counters last recomputed', from: 'meta.countersUpdatedAt', format: 'relative', staleAfterHours: 24 });

describe('a field no row can fill disappears', () => {
  it('drops revenue, because neither product has a revenue source', () => {
    expect(emptyFields([SEND, SLATE], [REVENUE]).map(f => f.key)).toStrictEqual(['revenue']);
  });

  it('keeps a field one row can fill, so a sparse column is still a column', () => {
    const owner = field({ key: 'owner', from: 'meta.accountableUser' });
    const shipped = field({ key: 'lastShipped', from: 'meta.lastShipped' });

    expect(emptyFields([SEND, SLATE], [owner, shipped])).toStrictEqual([]);
  });

  it('honours a field that opted out, because a checklist keeps its blanks', () => {
    const kept = field({ key: 'revenue', from: 'meta.revenueMonthCents', hideWhenEmpty: false });

    expect(emptyFields([SEND, SLATE], [kept])).toStrictEqual([]);
  });

  it('hides nothing when there are no rows, because an empty table is not evidence', () => {
    expect(emptyFields([], [REVENUE])).toStrictEqual([]);
  });

  it('takes the field out of the drawn layout, not just out of a list', () => {
    const layout = tableLayout([SEND, SLATE], [field({ key: 'title' }), REVENUE, PRICE], { field: 'title', subtitle: [] });

    expect(layout.columns.map(f => f.key)).toStrictEqual(['price']);
    expect(layout.dropped.map(f => f.key)).toStrictEqual(['revenue']);
  });
});

describe('health says what is missing, not that the product is doubtful', () => {
  it('reads Send, which has a check behind it', () => {
    expect(fieldHasSource(SEND, HEALTH)).toBe(true);
  });

  it('reads Slate, which nothing watches, as unsourced rather than unhealthy', () => {
    expect(fieldHasSource(SLATE, HEALTH)).toBe(false);
  });

  it('separates a degraded product from an unmonitored one', () => {
    const degraded = { ...SEND, meta: { ...SEND.meta, health: 'degraded' } };

    expect(fieldHasSource(degraded, HEALTH)).toBe(true);
    expect(fieldHasSource(SLATE, HEALTH)).toBe(false);
  });

  it('refuses to be fooled by a health value with no feed under it', () => {
    const claimed = { ...SLATE, meta: { ...SLATE.meta, health: 'ok' } };

    expect(fieldHasSource(claimed, HEALTH)).toBe(false);
  });

  it('leaves a field that never declared a source alone', () => {
    expect(fieldHasSource(SLATE, field({ key: 'stage', from: 'meta.stage' }))).toBe(true);
  });
});

describe('a comparison is one fact, drawn where either side is recorded', () => {
  it('is not empty for the product with a price and an incumbent', () => {
    expect(fieldIsEmptyOn(SEND, PRICE)).toBe(false);
  });

  it('is not empty for the product with only the incumbent named', () => {
    expect(fieldIsEmptyOn(SLATE, PRICE)).toBe(false);
  });

  it('is empty only when neither side is recorded', () => {
    const unpriced = { ...SLATE, meta: { stage: 'idea' } };

    expect(fieldIsEmptyOn(unpriced, PRICE)).toBe(true);
  });
});

describe('freshness appears only once it stops being fresh', () => {
  it('holds the stamp back on a board recomputed this morning', () => {
    expect(fieldIsFresh(SEND, STAMP, NOW)).toBe(true);
    expect(fieldIsEmptyOn(SEND, STAMP, NOW)).toBe(true);
  });

  it('draws it on a row whose figures are two days old', () => {
    const stale = { ...SEND, meta: { ...SEND.meta, countersUpdatedAt: '2026-09-19T11:00:00.000Z' } };

    expect(fieldIsFresh(stale, STAMP, NOW)).toBe(false);
    expect(fieldIsEmptyOn(stale, STAMP, NOW)).toBe(false);
  });

  it('removes the field from the page entirely while every row is current', () => {
    const fresh = { ...SLATE, meta: { ...SLATE.meta, countersUpdatedAt: '2026-09-21T11:00:00.000Z' } };
    const layout = tableLayout([SEND, fresh], [field({ key: 'title' }), STAMP], { field: 'title', subtitle: [] }, NOW);

    expect(layout.columns).toStrictEqual([]);
    expect(layout.dropped.map(f => f.key)).toStrictEqual(['updated']);
  });

  it('brings it back the moment one row goes stale', () => {
    const stale = { ...SLATE, meta: { ...SLATE.meta, countersUpdatedAt: '2026-09-18T11:00:00.000Z' } };
    const layout = tableLayout([SEND, stale], [field({ key: 'title' }), STAMP], { field: 'title', subtitle: [] }, NOW);

    expect(layout.columns.map(f => f.key)).toStrictEqual(['updated']);
  });
});

describe('the Products manifest the plugin ships', () => {
  const manifest = PageManifestSchema.parse({
    slug: 'products',
    title: 'Products',
    archetype: 'list',
    layout: 'block',
    statsMinRows: 8,
    source: { kind: 'objects', objectType: 'product' },
    primary: { field: 'title', subtitle: ['stage'] },
    fields: [{ key: 'title' }, { key: 'stage', from: 'meta.stage' }],
  });

  it('accepts a block layout on a list page', () => {
    expect(manifest.layout).toBe('block');
  });

  it('holds its summary back until there are enough rows to summarise', () => {
    expect(manifest.statsMinRows).toBe(8);
  });

  it('defaults every other page to what it did before', () => {
    const plain = PageManifestSchema.parse({ slug: 'x', title: 'X', archetype: 'list' });

    expect(plain.layout).toBe('table');
    expect(plain.statsMinRows).toBe(0);
  });

  it('refuses a block layout on a page with no rows to draw', () => {
    const bad = PageManifestSchema.safeParse({ slug: 'x', title: 'X', archetype: 'markdown', layout: 'block' });

    expect(bad.success).toBe(false);
  });
});
