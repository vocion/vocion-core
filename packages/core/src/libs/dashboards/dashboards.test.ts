import type { DashboardSpec, DashboardStat } from './spec';
import { describe, expect, it } from 'vitest';
import { cardPayloadFor, SPEC_SCHEMA_FOR_KIND } from '@/libs/cards/specs';
import { countsLine, reviewDashboard } from './checks';
import { asOfLabel, refreshAsk, statDelta, statValue } from './format';
import { dashboardSpecSchema } from './spec';

// Fictional: Northwind's operating view (fixtures cast, realDataGuard).
const revenue: DashboardStat = { label: 'Revenue', value: 454_300, format: 'currency', delta: { value: -14, format: 'percent', against: 'vs August', better: 'up' }, note: 'Sep 2026, accrual' };

function northwind(overrides: Partial<DashboardSpec> = {}): DashboardSpec {
  return dashboardSpecSchema.parse({
    title: 'Northwind operating view',
    summary: 'Revenue was **$454.3K** in September, down 14% on August.',
    sources: 'Ledger P&L and CRM deals, read daily.',
    asOf: '2026-10-29',
    tabs: [
      {
        label: 'Overview',
        sections: [
          { title: 'Company snapshot', blocks: [{ type: 'stats', items: [revenue, { label: 'Gross margin', value: 31, format: 'percent', target: { value: 60 } }, { label: 'Board commitments done', value: null, display: '1 / 5' }] }] },
          {
            title: 'Trends',
            blocks: [
              { type: 'chart', chart: { title: 'Revenue held near $450K a month', type: 'bar', x: ['Jul', 'Aug', 'Sep'], series: [{ name: 'Revenue', values: [420_000, 528_000, 454_300] }], format: 'currency', source: 'Ledger P&L', asOf: '2026-10-29' } },
              { type: 'chart', chart: { title: 'Margin fell to 31%', type: 'line', x: ['Jul', 'Aug', 'Sep'], series: [{ name: 'Gross margin', values: [58, 61, 31] }], format: 'percent', source: 'Ledger P&L', asOf: '2026-10-29' } },
            ],
          },
        ],
      },
      { label: 'Initiatives', sections: [{ blocks: [{ type: 'table', table: { columns: [{ key: 'name', label: 'Initiative' }, { key: 'score', label: 'Impact', type: 'number' }], rows: [{ name: 'Service expansion', score: 15 }] } }] }] },
    ],
    refresh: { cadence: 'daily', method: 'Revenue: ledger P&L by month, accrual. Margin: revenue minus cost of goods sold.' },
    ...overrides,
  });
}

describe('dashboard spec', () => {
  it('is an artifact kind with its own schema and card', () => {
    const spec = northwind();

    expect(SPEC_SCHEMA_FOR_KIND.dashboard.safeParse(spec).success).toBe(true);
    expect(cardPayloadFor('dashboard', spec, 7)).toMatchObject({ __card: 'dashboard', __artifactId: 7, title: 'Northwind operating view' });
  });

  it('refuses an undated dashboard and two tabs with one label', () => {
    expect(dashboardSpecSchema.safeParse({ ...northwind(), asOf: undefined }).success).toBe(false);

    const twice = { ...northwind(), tabs: [northwind().tabs[0], northwind().tabs[0]] };

    expect(dashboardSpecSchema.safeParse(twice).error?.issues[0]?.message).toBe('two tabs share a label');
  });

  it('refuses a chart the engine cannot draw honestly, naming where it sits', () => {
    const bad = northwind();
    bad.tabs[0]!.sections[1]!.blocks[0] = { type: 'chart', chart: { title: 'Stacked off its totals', type: 'bar', stack: 'stack', x: ['Jul'], series: [{ name: 'A', values: [1] }, { name: 'B', values: [2] }], totals: [10] } };
    const review = reviewDashboard(bad);

    expect(review.refusals).toHaveLength(1);
    expect(review.refusals[0]).toMatch(/tab "Overview", "Trends", chart 1/);
  });

  it('counts what was drawn and asks for the recipe when it is missing', () => {
    const review = reviewDashboard(northwind({ refresh: undefined }));

    expect(countsLine(review.counts)).toBe('2 tabs, 3 figures, 2 charts, 1 table');
    expect(review.notes.some(n => n.includes('refresh.method'))).toBe(true);
    expect(reviewDashboard(northwind()).notes.some(n => n.includes('refresh.method'))).toBe(false);
  });
});

describe('figures', () => {
  it('reads a figure in its format, compact by default', () => {
    expect(statValue(revenue)).toBe('$454.3k');
    expect(statValue({ label: 'Done', value: null, display: '1 / 5' })).toBe('1 / 5');
    expect(statValue({ label: 'Margin', value: null })).toBe('Not read');
  });

  it('colours a move by whether it is good news', () => {
    expect(statDelta(revenue)).toEqual({ value: '14%', direction: 'down', tone: 'fail', against: 'vs August' });
    expect(statDelta({ ...revenue, delta: { value: -3, format: 'number', against: 'vs last week', better: 'down' } })?.tone).toBe('pass');
    expect(statDelta({ ...revenue, delta: { value: 2, against: 'vs plan', better: 'neither' } })?.tone).toBe('neutral');
  });

  it('dates the dashboard and words the refresh as the person', () => {
    expect(asOfLabel('2026-10-29')).toBe('Oct 29, 2026');
    expect(refreshAsk('Northwind operating view', 7)).toContain('artifact #7');
  });
});
