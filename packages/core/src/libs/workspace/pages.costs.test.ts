import type { PageRow } from './pages';
import { describe, expect, it } from 'vitest';
import { applyFilter, computeSeries, computeStat, computeTotals, formatMoney, groupRows, PageManifestSchema, sinceStart } from './pages';

// What the software factory's cost pages needed from the list archetype, and
// nothing a workspace could not use for a sales pipeline: a `sum` stat that
// renders as money, a `since` window on a filter, a total under a column,
// a group per tag when the field is a list, and a strip of figures by week.

const NOW = new Date('2026-09-20T15:00:00Z'); // a Sunday

function row(id: number, meta: Record<string, unknown>): PageRow {
  return { id, title: `r${id}`, status: null, createdAt: null, meta };
}

describe('money', () => {
  it('cents become dollars, sign first, fractions rounded', () => {
    expect(formatMoney(1234)).toBe('$12.34');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(-50)).toBe('-$0.50');
    expect(formatMoney(199.6)).toBe('$2.00');
  });

  it('a sum stat adds the field, and format: money renders it as dollars', () => {
    const rows = [row(1, { actualCents: 1200 }), row(2, { actualCents: 350 }), row(3, {})];

    expect(computeStat(rows, { label: 'Spent', kind: 'sum', field: 'meta.actualCents', format: 'money' })).toBe('$15.50');
    expect(computeStat(rows, { label: 'Spent', kind: 'sum', field: 'meta.actualCents', format: 'number' })).toBe('1550');
    // An average is over the rows that carry the field — the third row is not a $0 feature.
    expect(computeStat(rows, { label: 'Avg', kind: 'avg', field: 'meta.actualCents', format: 'money' })).toBe('$7.75');
    expect(computeStat([], { label: 'Spent', kind: 'sum', field: 'meta.actualCents', format: 'money' })).toBe('$0.00');
  });

  it('the manifest accepts sum and money on a stat, and refuses a since with no window', () => {
    const base = { slug: 'costs', title: 'Costs', archetype: 'list', source: { kind: 'objects', objectType: 'request' } };

    expect(PageManifestSchema.safeParse({ ...base, stats: [{ label: 'Spent', kind: 'sum', field: 'meta.actualCents', format: 'money' }] }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ ...base, stats: [{ label: 'Spent', kind: 'sum', field: 'meta.actualCents', where: { field: 'meta.at', op: 'since', value: 'month' } }] }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ ...base, stats: [{ label: 'Spent', kind: 'sum', field: 'meta.actualCents', where: { field: 'meta.at', op: 'since', value: 'yesterday' } }] }).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...base, stats: [{ label: 'Spent', kind: 'sum', format: 'euros' }] }).success).toBe(false);
  });
});

describe('since', () => {
  it('knows where the month, the week (Monday), today and n days back start, in UTC', () => {
    expect(sinceStart('month', NOW).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(sinceStart('week', NOW).toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(sinceStart('today', NOW).toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(sinceStart('7d', NOW).toISOString()).toBe('2026-09-13T15:00:00.000Z');
  });

  it('keeps the rows whose date is inside the window, reading Dates and ISO strings alike', () => {
    const rows = [
      row(1, { at: '2026-09-02T00:00:00Z' }),
      row(2, { at: new Date('2026-08-31T23:59:59Z') }),
      row(3, {}),
      row(4, { at: 'not a date' }),
    ];

    expect(applyFilter(rows, [{ field: 'meta.at', op: 'since', value: 'month' }], NOW).map(r => r.id)).toEqual([1]);
    expect(computeStat([row(1, { at: '2026-09-02T00:00:00Z', cents: 100 }), row(2, { at: '2026-07-02T00:00:00Z', cents: 900 })], { label: 'This month', kind: 'sum', field: 'meta.cents', format: 'money', where: { field: 'meta.at', op: 'since', value: 'month' } }, NOW)).toBe('$1.00');
  });
});

describe('totals and groups', () => {
  it('sums the columns marked total, rendered as the column renders', () => {
    const fields = [
      { key: 'title', format: 'text' as const, total: false },
      { key: 'actual', from: 'meta.actualCents', format: 'money' as const, total: true },
      { key: 'tasks', from: 'meta.taskCount', format: 'mono' as const, total: true },
    ];
    const rows = [row(1, { actualCents: 1000, taskCount: 2 }), row(2, { actualCents: 25, taskCount: 1 }), row(3, {})];

    expect(computeTotals(rows, fields)).toEqual({ actual: '$10.25', tasks: '3' });
    expect(computeTotals(rows, [fields[0]!])).toEqual({});
  });

  it('a row tagged twice sits under both tags; no tags is the dash', () => {
    const rows = [
      row(1, { tags: ['search', 'billing'], actualCents: 100 }),
      row(2, { tags: ['search'], actualCents: 50 }),
      row(3, { tags: [], actualCents: 7 }),
      row(4, { actualCents: 1 }),
    ];
    const groups = groupRows(rows, 'meta.tags');

    expect(groups.map(g => [g.label, g.rows.map(r => r.id)])).toEqual([
      ['search', [1, 2]],
      ['billing', [1]],
      ['—', [3, 4]],
    ]);
    // The total under a tag is the cumulative spend on everything that carried it.
    expect(computeTotals(groups[0]!.rows, [{ key: 'actual', from: 'meta.actualCents', format: 'money', total: true }])).toEqual({ actual: '$1.50' });
  });

  it('a scalar groups the way it always did', () => {
    const groups = groupRows([row(1, { product: 'a' }), row(2, { product: 'b' }), row(3, { product: 'a' }), row(4, {})], 'meta.product');

    expect(groups.map(g => [g.label, g.rows.length])).toEqual([['a', 2], ['b', 1], ['—', 1]]);
  });
});

describe('series', () => {
  it('buckets the last n weeks oldest first, each measure over the rows whose date fell in the week', () => {
    const rows = [
      row(1, { at: '2026-09-15T10:00:00Z', est: 500, act: 450 }), // this week (Mon 14 Sep)
      row(2, { at: '2026-09-13T23:00:00Z', est: 200, act: 260 }), // last week (Mon 7 Sep)
      row(3, { at: '2026-09-08T00:00:00Z', est: 100, act: 100 }), // last week
      row(4, { at: '2026-06-01T00:00:00Z', est: 999, act: 999 }), // before the window
      row(5, { est: 5, act: 5 }), // no date — left out
    ];
    const s = computeSeries(rows, {
      label: 'Per week',
      dateField: 'meta.at',
      bucket: 'week',
      buckets: 3,
      format: 'money',
      measures: [{ label: 'Estimated', field: 'meta.est', kind: 'sum' }, { label: 'Actual', field: 'meta.act', kind: 'sum' }],
    }, NOW);

    expect(s.buckets).toEqual(['Aug 31', 'Sep 7', 'Sep 14']);
    expect(s.measures).toEqual([
      { label: 'Estimated', values: ['$0.00', '$3.00', '$5.00'] },
      { label: 'Actual', values: ['$0.00', '$3.60', '$4.50'] },
    ]);
  });

  it('months and days label themselves, and a count needs no field to be numeric', () => {
    const rows = [row(1, { at: '2026-09-01T00:00:00Z' }), row(2, { at: '2026-08-15T00:00:00Z' }), row(3, { at: '2026-08-20T00:00:00Z' })];
    const months = computeSeries(rows, { label: 'Per month', dateField: 'meta.at', bucket: 'month', buckets: 2, format: 'number', measures: [{ label: 'Rows', field: 'meta.at', kind: 'count' }] }, NOW);

    expect(months.buckets).toEqual(['Aug 2026', 'Sep 2026']);
    expect(months.measures[0]?.values).toEqual(['2', '1']);

    const days = computeSeries(rows, { label: 'Per day', dateField: 'meta.at', bucket: 'day', buckets: 2, format: 'number', measures: [{ label: 'Rows', field: 'meta.at', kind: 'count' }] }, NOW);

    expect(days.buckets).toEqual(['Sep 19', 'Sep 20']);
  });

  it('is part of the manifest, bounded', () => {
    const base = { slug: 'floor', title: 'Floor', archetype: 'list', source: { kind: 'objects', objectType: 'engineering_task' } };
    const ok = PageManifestSchema.safeParse({ ...base, series: [{ label: 'Per week', dateField: 'meta.costUpdatedAt', measures: [{ label: 'Actual', field: 'meta.actualCents' }] }] });

    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.series?.[0]).toMatchObject({ bucket: 'week', buckets: 8, format: 'number', measures: [{ kind: 'sum' }] });
    expect(PageManifestSchema.safeParse({ ...base, series: [{ label: 'x', dateField: 'meta.at', measures: [] }] }).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...base, series: [{ label: 'x', dateField: 'meta.at', buckets: 1, measures: [{ label: 'a', field: 'meta.a' }] }] }).success).toBe(false);
  });
});
