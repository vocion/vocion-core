import { describe, expect, it } from 'vitest';
import { cardPayloadFor, chartSpecSchema, dataTableSpecSchema, recordSpecSchema } from './specs';

describe('card specs', () => {
  it('accepts a typed table and rejects an empty column list', () => {
    const ok = dataTableSpecSchema.safeParse({ columns: [{ key: 'name' }, { key: 'amount', type: 'currency' }], rows: [{ name: 'Acme', amount: 1200 }] });

    expect(ok.success).toBe(true);
    expect(dataTableSpecSchema.safeParse({ columns: [], rows: [] }).success).toBe(false);
  });

  it('requires every chart series to align with x', () => {
    const bad = chartSpecSchema.safeParse({ type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'Pipeline', values: [1] }] });

    expect(bad.success).toBe(false);
    expect(bad.success ? '' : bad.error.issues[0]!.message).toMatch(/1 values for 2 x labels/);

    const good = chartSpecSchema.safeParse({ type: 'bar', x: ['Jan', 'Feb'], series: [{ name: 'Pipeline', values: [1, null] }] });

    expect(good.success).toBe(true);
  });

  it('caps chart series at eight — categorical hues are fixed, never cycled', () => {
    const series = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, values: [1] }));

    expect(chartSpecSchema.safeParse({ type: 'line', x: ['a'], series }).success).toBe(false);
  });

  it('defaults record fields to an empty list', () => {
    const r = recordSpecSchema.parse({ type: 'Deal', id: '1', label: 'Acme' });

    expect(r.fields).toEqual([]);
  });

  it('reshapes a file artifact into the link card payload', () => {
    const p = cardPayloadFor('file', { filename: 'deals.csv', contentType: 'text/csv', bytes: 2048, url: '/artifacts/x.csv' });

    expect(p).toMatchObject({ __card: 'link', href: '/api/artifacts/x/x.csv', title: 'deals.csv' });
    expect(String(p.description)).toContain('2 KB');
    expect(cardPayloadFor('table', { columns: [] })).toMatchObject({ __card: 'data-table' });
  });
});
