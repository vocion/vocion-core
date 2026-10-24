import { describe, expect, it } from 'vitest';
import { expandChartBlocks } from './documentBlocks';
import { niceTicks } from './format';
import { layoutChart, placeXLabels, trendLine } from './layout';
import { lintChart } from './lint';
import { VIZ_DARK, VIZ_LIGHT, VIZ_VARS } from './palette';
import { axisKindOf, isPeriodLabel } from './periods';
import { chartSpecSchema } from './spec';
import { renderChartSvg } from './svg';

describe('the trend line', () => {
  it('fits a straight line through the values', () => {
    expect(trendLine([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(trendLine([4, 4, 4])).toEqual([4, 4, 4]);
  });

  it('skips a missing value rather than reading it as zero', () => {
    expect(trendLine([2, null, 6])).toEqual([2, 4, 6]);
  });

  it('draws nothing with fewer than two points', () => {
    expect(trendLine([5])).toBeNull();
    expect(trendLine([null, 3])).toBeNull();
  });
});

describe('the chart\'s y axis', () => {
  it('ends at or above the largest value, so no bar rises past it', () => {
    expect(niceTicks(17)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(565_000).at(-1)).toBeGreaterThanOrEqual(565_000);
  });

  it('stops at a round max without adding a tick above it', () => {
    expect(niceTicks(30)).toEqual([0, 10, 20, 30]);
  });

  it('draws a single baseline when there is nothing to scale', () => {
    expect(niceTicks(0)).toEqual([0]);
  });
});

// ---- the engine (2026-10-23): one spec, one lint, one layout -------------

/** The chart Chris was shown: cumulative bars, months and year-end scenarios on one axis. Fictional numbers. */
const MISLEADING = {
  title: '2026 Revenue',
  type: 'bar' as const,
  x: ['Jul', 'Aug', 'Sep', 'Oct 23*', 'EOY: booked', '+weighted'],
  series: [{ name: 'Revenue', values: [2.1, 2.6, 3.0, 3.4, 3.5, 4.2] }],
  aggregation: 'cumulative' as const,
  format: 'currency' as const,
};

/** What it should have been: each month's own amount, stacked, the forecast marked. Fictional numbers. */
const STACKED_BY_MONTH = {
  title: 'On pace for $4.4M, with December carried by pipeline',
  type: 'bar' as const,
  x: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  series: [
    { name: 'Invoiced', values: [310, 295, 330, 342, 351, 360, 372, 380, 395, 410, 205, 120].map(v => v * 1000) },
    { name: 'Weighted pipeline', values: [null, null, null, null, null, null, null, null, null, null, 140, 260].map(v => (v === null ? null : v * 1000)), forecast: true },
  ],
  stack: 'stack' as const,
  aggregation: 'period' as const,
  forecastFrom: 'Nov',
  format: 'currency' as const,
  currency: 'USD',
  marker: { x: 'Oct', label: 'Today' },
  source: 'Ledger P&L by month; CRM open deals at stage probability',
  asOf: '2026-10-23',
};

const spec = (s: unknown) => chartSpecSchema.parse(s);
const rules = (r: { errors: Array<{ rule: string }>; warnings: Array<{ rule: string }> }) => ({ errors: r.errors.map(e => e.rule), warnings: r.warnings.map(w => w.rule) });

describe('the chart spec', () => {
  it('still takes the original card spec as written', () => {
    expect(chartSpecSchema.safeParse({ type: 'bar', x: ['Jan', 'Feb'], series: [{ name: 'Pipeline', values: [1, null] }], unit: '$', stacked: true }).success).toBe(true);
  });

  it('refuses a forecastFrom, a marker or totals that do not line up with x', () => {
    const base = { type: 'bar', x: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }] };

    expect(chartSpecSchema.safeParse({ ...base, forecastFrom: 'Mar' }).success).toBe(false);
    expect(chartSpecSchema.safeParse({ ...base, marker: { x: 'Mar', label: 'Today' } }).success).toBe(false);
    expect(chartSpecSchema.safeParse({ ...base, totals: [1] }).success).toBe(false);
  });
});

describe('reading x labels as periods', () => {
  it('knows months, days, quarters, years, weeks and ISO dates by their form', () => {
    for (const l of ['Jul', 'July 2026', 'Oct 23*', 'Q3', 'Q3 2026', '2026-Q3', 'FY26', '2026', '2026-07', 'W14', 'H1']) {
      expect(isPeriodLabel(l), l).toBe(true);
    }
    for (const l of ['EOY: booked', '+weighted', 'Northwind', 'Plan']) {
      expect(isPeriodLabel(l), l).toBe(false);
    }
  });

  it('calls an axis of months and scenarios mixed', () => {
    expect(axisKindOf(MISLEADING.x).kind).toBe('mixed');
    expect(axisKindOf(STACKED_BY_MONTH.x).kind).toBe('periods');
    expect(axisKindOf(['Acme', 'Globex']).kind).toBe('categories');
  });
});

describe('the chart lint', () => {
  it('refuses the chart Chris was shown: a mixed axis and cumulative bars', () => {
    expect(rules(lintChart(spec(MISLEADING))).errors).toEqual(expect.arrayContaining(['mixed-axis', 'cumulative-bars']));
  });

  it('flags rising bars as a likely running total when nobody said what they are', () => {
    const { aggregation: _, ...unsaid } = { ...MISLEADING, x: ['Jul', 'Aug', 'Sep', 'Oct'], series: [{ name: 'Revenue', values: [1, 2, 3, 4] }] };

    expect(rules(lintChart(spec(unsaid))).warnings).toContain('running-total');
  });

  it('passes the stacked-by-month version clean', () => {
    const r = lintChart(spec(STACKED_BY_MONTH));

    expect(r.errors).toEqual([]);
    expect(rules(r).warnings).not.toContain('title-restates-axes');
  });

  it('refuses a stack that does not sum to its stated totals', () => {
    const s = spec({ ...STACKED_BY_MONTH, totals: STACKED_BY_MONTH.x.map((_, i) => (i === 0 ? 999 : null)) });

    expect(rules(lintChart(s)).errors).toContain('stack-total');
  });

  it('refuses a second y axis, a missing format, and (in the spec) more than eight series', () => {
    expect(rules(lintChart(spec({ type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [1, 2], axis: 'right' }], format: 'number' }))).errors).toContain('dual-axis');
    expect(rules(lintChart(spec({ type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }] }))).errors).toContain('missing-format');

    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, values: [1, 2] }));
    const tooMany = chartSpecSchema.safeParse({ type: 'line', x: ['Jan', 'Feb'], series: nine, format: 'number' });

    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.message).toContain('fold the rest into "Other"');
  });

  it('refuses category labels that cannot be drawn apart on a phone', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Northwind Regional Holdings ${i}`);

    expect(rules(lintChart(spec({ type: 'bar', x: names, series: [{ name: 'Spend', values: names.map(() => 1) }], format: 'number' }))).errors).toContain('label-collision');
  });

  it('refuses bars too thin to see on a phone', () => {
    const x = Array.from({ length: 90 }, (_, i) => `Item ${i}`);

    expect(rules(lintChart(spec({ type: 'bar', x, series: [{ name: 'A', values: x.map(() => 1) }, { name: 'B', values: x.map(() => 1) }], format: 'number' }))).errors).toContain('too-many-categories');
  });

  it('asks for a finding when the title only names the axes', () => {
    expect(rules(lintChart(spec({ title: 'Revenue by month', type: 'bar', x: ['Jan', 'Feb'], series: [{ name: 'Revenue', values: [1, 2] }], format: 'currency', aggregation: 'period' }))).warnings).toContain('title-restates-axes');
  });
});

describe('the layout at a phone\'s width', () => {
  it('draws every month at desktop width and none overlapping on a phone', () => {
    const s = spec(STACKED_BY_MONTH);
    const labels = (w: number) => layoutChart(s, { width: w }).marks.filter(m => m.kind === 'text' && m.y > layoutChart(s, { width: w }).height - 20) as Array<{ x: number; text: string; size: number }>;

    expect(labels(960).map(l => l.text)).toEqual(STACKED_BY_MONTH.x);

    const phone = labels(320);
    for (let i = 1; i < phone.length; i++) {
      const prev = phone[i - 1]!;
      const cur = phone[i]!;
      const room = cur.x - prev.x;

      expect(room).toBeGreaterThan((prev.text.length + cur.text.length) * cur.size * 0.58 / 2);
    }

    expect(phone.at(-1)?.text.startsWith('D')).toBe(true);
  });

  it('thins a long period axis rather than shrinking the text', () => {
    const x = Array.from({ length: 36 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}`);
    const drawn = placeXLabels(x, 300 / 36, 11, true).drawn;

    expect(drawn.length).toBeLessThan(36);
    expect(drawn.at(-1)?.i).toBe(35);
  });
});

describe('drawing each kind', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr'];
  const two = [{ name: 'New', values: [3, 4, 5, 6] }, { name: 'Expansion', values: [1, 2, 2, 3] }];
  const count = (svg: string, tag: string) => (svg.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;

  it('groups, stacks and stacks to 100%', () => {
    const grouped = renderChartSvg(spec({ type: 'bar', x: months, series: two, format: 'number' }), { width: 640 });
    const stacked = renderChartSvg(spec({ type: 'bar', x: months, series: two, stack: 'stack', format: 'number' }), { width: 640 });
    const percent = renderChartSvg(spec({ type: 'bar', x: months, series: two, stack: 'percent' }), { width: 640 });

    expect(count(grouped, 'rect')).toBe(8);
    expect(count(stacked, 'rect')).toBe(8);
    expect(percent).toContain('>100%<');
  });

  it('draws a forecast hatched on bars and dashed on lines, and says so in the legend', () => {
    const s = spec(STACKED_BY_MONTH);
    const svg = renderChartSvg(s, { width: 640 });

    expect(svg).toContain('<pattern id="vc-hatch-1"');
    expect(layoutChart(s, { width: 640 }).legend.map(l => l.label)).toEqual(expect.arrayContaining(['Weighted pipeline (forecast)', 'Forecast from Nov']));

    const line = renderChartSvg(spec({ type: 'line', x: months, series: [two[0]!], forecastFrom: 'Mar', format: 'number' }), { width: 640 });

    expect(line).toContain('stroke-dasharray="5 4"');
  });

  it('draws areas, a waterfall with its connectors, a target and a today marker', () => {
    expect(renderChartSvg(spec({ type: 'area', x: months, series: two, stack: 'stack', format: 'number' }), { width: 640 })).toContain('fill-opacity="0.18"');

    const fall = renderChartSvg(spec({ type: 'waterfall', x: ['Q3', 'New', 'Churn', 'Q4'], series: [{ name: 'ARR', values: [100, 30, -12, 118] }], waterfallTotals: ['Q3', 'Q4'], format: 'currency' }), { width: 640 });

    expect(count(fall, 'rect')).toBe(4);
    expect(fall).toContain('stroke-dasharray="2 2"');

    const marked = renderChartSvg(spec({ type: 'line', x: months, series: [two[0]!], targets: [{ value: 5, label: 'Plan' }], marker: { x: 'Mar', label: 'Today' }, format: 'number' }), { width: 640 });

    expect(marked).toContain('>Plan 5<');
    expect(marked).toContain('>Today<');
  });

  it('carries a title, a description and the data for screen readers', () => {
    const scene = layoutChart(spec(STACKED_BY_MONTH), { width: 640 });

    expect(scene.desc).toContain('Stacked bar chart');
    expect(scene.table.head).toEqual(['', 'Invoiced', 'Weighted pipeline', 'Total']);
    expect(scene.table.rows[10]![0]).toBe('Nov (forecast)');
  });
});

describe('chart blocks in documents', () => {
  const doc = (body: string) => `<!doctype html><html><head><style>.x{}</style></head><body><article class="sheet">${body}</article></body></html>`;
  const block = (s: unknown) => `<figure class="vocion-chart"><script type="application/json">${JSON.stringify(s)}</script></figure>`;

  it('draws a block from its spec, keeps the spec, and redraws the same on a second pass', () => {
    const once = expandChartBlocks(doc(block(STACKED_BY_MONTH)));

    expect(once.errors).toEqual([]);
    expect(once.count).toBe(1);
    expect(once.html).toContain('<svg');
    expect(once.html).toContain('type="application/json"');
    expect(expandChartBlocks(once.html).html).toBe(once.html);
  });

  it('refuses a block that fails the lint, by block', () => {
    const r = expandChartBlocks(doc(block(MISLEADING)));

    expect(r.errors.join('\n')).toContain('chart block 1 [mixed-axis]');
  });

  it('leaves everything outside the blocks byte for byte, and notices a hand-drawn chart', () => {
    const hand = '<svg><rect/><rect/><rect/><rect/></svg>';
    const r = expandChartBlocks(doc(`<p>Intro</p>${hand}`));

    expect(r.html).toBe(doc(`<p>Intro</p>${hand}`));
    expect(r.warnings[0]).toContain('drawn by hand');
  });
});

describe('the palette', () => {
  it('keeps the card\'s Tailwind classes and the string renderer on the same colors', () => {
    VIZ_LIGHT.forEach((c, i) => {
      expect(VIZ_VARS).toContain(`[--viz-${i + 1}:${c}] dark:[--viz-${i + 1}:${VIZ_DARK[i]}]`);
    });
  });
});
