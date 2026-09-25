import type { PageField, PageRow } from './pages';
import { describe, expect, it } from 'vitest';
import {
  constantColumns,
  fieldAlign,
  isEmptyValue,
  PageManifestSchema,
  priorityClass,
  shortUrlLabel,
  tableLayout,
} from './pages';

/**
 * How a list page's rows are laid out — the readability half of the Factory
 * floor fix. Fourteen columns at 1440px wrapped the title to four lines and
 * pushed the pull request off the right edge; these are the rules that stop
 * that, tested on the data rather than on the pixels (the pixels are the
 * stories in features/dashboard/pages).
 */

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true, ...over };
}

function row(id: number, meta: Record<string, unknown>): PageRow {
  return { id, title: `task ${id}`, status: 'running', createdAt: new Date('2026-09-01T00:00:00Z'), meta };
}

describe('nothing, as opposed to false', () => {
  it('calls undefined, null, the empty string and the empty list nothing — and false and zero something', () => {
    expect([undefined, null, '', []].map(isEmptyValue)).toEqual([true, true, true, true]);
    expect([false, 0, 'x', ['x']].map(isEmptyValue)).toEqual([false, false, false, false]);
  });
});

describe('which edge a column sits against', () => {
  it('puts figures on the right and everything else on the left, and lets a page say otherwise', () => {
    expect(fieldAlign(field({ key: 'actual', format: 'money' }))).toBe('right');
    expect(fieldAlign(field({ key: 'score', format: 'score' }))).toBe('right');
    expect(fieldAlign(field({ key: 'title' }))).toBe('left');
    expect(fieldAlign(field({ key: 'tasks', format: 'mono', align: 'right' }))).toBe('right');
    expect(fieldAlign(field({ key: 'actual', format: 'money', align: 'left' }))).toBe('left');
  });
});

describe('how hard a column holds on', () => {
  it('never drops a 1, drops a 3 below a wide desktop and a 2 below a tablet', () => {
    expect(priorityClass(1)).toBe('');
    expect(priorityClass(2)).toBe('hidden @2xl:table-cell');
    expect(priorityClass(3)).toBe('hidden @5xl:table-cell');
  });

  it('defaults a column to priority 1 — a page that says nothing keeps every column', () => {
    const page = PageManifestSchema.parse({
      slug: 'p',
      title: 'P',
      archetype: 'list',
      fields: [{ key: 'title' }, { key: 'actual', from: 'meta.actualCents', format: 'money' }],
    });

    expect(page.fields?.map(f => f.priority)).toEqual([1, 1]);
    expect(page.fields?.map(f => f.hideWhenConstant)).toEqual([false, false]);
    // A missing optional capability makes the interface smaller by default.
    expect(page.fields?.map(f => f.hideWhenEmpty)).toEqual([true, true]);
  });
});

describe('a column that says one thing', () => {
  const fields = [
    field({ key: 'repo', from: 'meta.repoSlug', hideWhenConstant: true }),
    field({ key: 'product', from: 'meta.productSlug', hideWhenConstant: true }),
    field({ key: 'risk', from: 'meta.riskClass' }),
  ];

  it('collapses when every visible row carries the same value', () => {
    const rows = [
      row(1, { repoSlug: 'squatch-core', productSlug: 'send', riskClass: 'logic' }),
      row(2, { repoSlug: 'squatch-core', productSlug: 'send', riskClass: 'ui' }),
    ];

    expect(constantColumns(rows, fields).map(c => [c.field.key, c.value])).toEqual([
      ['repo', 'squatch-core'],
      ['product', 'send'],
    ]);
  });

  it('stays a column when the rows disagree, when a row is missing it, or when it never opted in', () => {
    expect(constantColumns([
      row(1, { repoSlug: 'squatch-core', productSlug: 'send' }),
      row(2, { repoSlug: 'squatch-www', productSlug: 'send' }),
    ], fields).map(c => c.field.key)).toEqual(['product']);

    expect(constantColumns([
      row(1, { repoSlug: 'squatch-core' }),
      row(2, {}),
    ], fields)).toEqual([]);

    // `risk` is the same on both rows and never asked to collapse.
    expect(constantColumns([row(1, { riskClass: 'logic' }), row(2, { riskClass: 'logic' })], fields)).toEqual([]);
  });

  it('leaves a single row alone — one row repeats nothing', () => {
    expect(constantColumns([row(1, { repoSlug: 'squatch-core' })], fields)).toEqual([]);
  });
});

describe('the row leads with one wide column', () => {
  const fields = [
    field({ key: 'title', label: 'Task' }),
    field({ key: 'repo', from: 'meta.repoSlug', hideWhenConstant: true }),
    field({ key: 'risk', from: 'meta.riskClass' }),
    field({ key: 'attempt', from: 'meta.attempt' }),
    field({ key: 'status', from: 'status', format: 'badge' }),
    field({ key: 'actual', from: 'meta.actualCents', format: 'money', priority: 2 }),
  ];
  const primary = { field: 'title', subtitle: ['repo', 'risk', 'attempt'] };

  it('takes the primary and its subtitle out of the columns', () => {
    const rows = [
      row(1, { repoSlug: 'a', riskClass: 'logic', attempt: 2, actualCents: 400 }),
      row(2, { repoSlug: 'b', riskClass: 'ui', attempt: 1, actualCents: 512 }),
    ];
    const layout = tableLayout(rows, fields, primary);

    expect(layout.primary?.key).toBe('title');
    expect(layout.subtitle.map(f => f.key)).toEqual(['repo', 'risk', 'attempt']);
    expect(layout.columns.map(f => f.key)).toEqual(['status', 'actual']);
  });

  it('hoists a constant subtitle fact too — a repository the same on every row is said once, not once per row', () => {
    const rows = [
      row(1, { repoSlug: 'squatch-core', riskClass: 'logic', attempt: 2, actualCents: 400 }),
      row(2, { repoSlug: 'squatch-core', riskClass: 'ui', attempt: 1, actualCents: 512 }),
    ];
    const layout = tableLayout(rows, fields, primary);

    expect(layout.constants.map(c => [c.field.label, c.value])).toEqual([['repo', 'squatch-core']]);
    expect(layout.subtitle.map(f => f.key)).toEqual(['risk', 'attempt']);
  });

  it('is every column, in declaration order, on a page that declared no primary', () => {
    const rows = [
      row(1, { repoSlug: 'a', riskClass: 'logic', attempt: 2, actualCents: 400 }),
      row(2, { repoSlug: 'b', riskClass: 'ui', attempt: 1, actualCents: 512 }),
    ];
    const layout = tableLayout(rows, fields);

    expect(layout.primary).toBeNull();
    expect(layout.subtitle).toEqual([]);
    expect(layout.columns.map(f => f.key)).toEqual(fields.map(f => f.key));
  });

  it('drops a column no row can fill, leaving the page smaller rather than gappy', () => {
    const layout = tableLayout([row(1, {}), row(2, {})], fields);

    expect(layout.primary).toBeNull();
    expect(layout.columns.map(f => f.key)).toEqual(['title', 'status']);
    expect(layout.dropped.map(f => f.key)).toEqual(['repo', 'risk', 'attempt', 'actual']);
  });
});

describe('the page manifest', () => {
  it('refuses a primary that names a field the page does not declare', () => {
    const bad = PageManifestSchema.safeParse({
      slug: 'p',
      title: 'P',
      archetype: 'list',
      fields: [{ key: 'title' }],
      primary: { field: 'title', subtitle: ['nope'] },
    });

    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain('primary names a field this page does not declare');
  });

  it('takes a primary whose every key is declared', () => {
    const ok = PageManifestSchema.safeParse({
      slug: 'p',
      title: 'P',
      archetype: 'list',
      fields: [{ key: 'title' }, { key: 'repo', from: 'meta.repoSlug' }],
      primary: { field: 'title', subtitle: ['repo'] },
    });

    expect(ok.success).toBe(true);
    expect(ok.data?.primary).toEqual({ field: 'title', subtitle: ['repo'] });
  });
});

describe('a URL as a column', () => {
  it('reads a pull request as its number and anything else as host and last segment', () => {
    expect(shortUrlLabel('https://github.com/squatch/squatch-core/pull/318')).toBe('#318');
    expect(shortUrlLabel('https://gitlab.com/acme/web/-/merge_requests/9')).toBe('#9');
    expect(shortUrlLabel('https://github.com/squatch/squatch-core/issues/522')).toBe('#522');
    expect(shortUrlLabel('https://github.com/squatch/squatch-core/actions/runs/1234')).toBe('github.com/1234');
    expect(shortUrlLabel('https://www.example.com/')).toBe('example.com');
    expect(shortUrlLabel('not a url at all')).toBe('not a url at all');
  });
});

describe('the picture that leads a block', () => {
  const fields = [field({ key: 'title' }), field({ key: 'shot', format: 'image', from: 'meta.shot' }), field({ key: 'cost' })];
  const primary = { field: 'title', subtitle: [], thumb: 'shot' };

  it('is pulled out of the facts, so it is drawn rather than labelled', () => {
    const layout = tableLayout([row(1, { shot: '/a.svg', cost: '$4' })], fields, primary);

    expect(layout.thumb?.key).toBe('shot');
    expect(layout.columns.map(c => c.key)).toEqual(['cost']);
  });

  it('keeps the slot when no row has a picture yet', () => {
    // The opposite of the usual rule, and only because this is a GRID: a card
    // whose text starts at a different left edge from the one beside it costs
    // more to read than a hole costs to look at.
    const layout = tableLayout([row(1, { cost: '$4' }), row(2, { cost: '$9' })], fields, primary);

    expect(layout.thumb?.key).toBe('shot');
  });

  it('is nothing on a page that declared none', () => {
    expect(tableLayout([row(1, {})], fields, { field: 'title', subtitle: [] }).thumb).toBeNull();
    expect(tableLayout([row(1, {})], fields).thumb).toBeNull();
  });

  it('is nothing when the page names a field it does not have', () => {
    expect(tableLayout([row(1, {})], fields, { field: 'title', subtitle: [], thumb: 'nope' }).thumb).toBeNull();
  });
});
