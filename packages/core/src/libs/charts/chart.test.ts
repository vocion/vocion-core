import { describe, expect, it } from 'vitest';
import { checkChart } from './checks';
import { expandChartBlocks } from './documentBlocks';
import { niceTicks } from './format';
import { foldSeries, layoutChart, placeXLabels, trendLine } from './layout';
import { VIZ_DARK, VIZ_LIGHT, VIZ_VARS } from './palette';
import { axisKindOf, isPeriodLabel } from './periods';
import { reviewChart } from './review';
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
const rules = (r: { refusals: Array<{ rule: string }>; signals: Array<{ rule: string }> }) => ({ refusals: r.refusals.map(e => e.rule), signals: r.signals.map(w => w.rule) });

/** A P&L bridge from $5.1M revenue to $46K net income, as Chris was shown it on 2026-10-24 (fictional numbers, full names). */
const PNL_BRIDGE = {
  title: 'Base case: the year ends about $46K net profit on $5.11M revenue',
  type: 'waterfall' as const,
  x: ['Revenue', 'Delivery cost', 'Gross profit', 'Operating expenses', 'Operating profit', 'Interest', 'Bonus pool', 'Tax', 'Net income'],
  series: [{ name: 'FY2026 base case', values: [5110000, -2520000, null, -2478000, null, -38000, -4600, -23400, null], forecast: true }],
  waterfallTotals: ['Revenue', 'Gross profit', 'Operating profit', 'Net income'],
  format: 'currency' as const,
  currency: 'USD',
  source: 'Ledger P&L, year to date plus base case',
  asOf: '2026-10-24',
};

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

describe('the chart checks: few refusals, the rest for the model to judge (2026-10-24)', () => {
  it('draws the chart Chris was shown, and tells the model what an analyst would say about it', () => {
    const r = rules(checkChart(spec(MISLEADING)));

    expect(r.refusals).toEqual([]);
    expect(r.signals).toEqual(expect.arrayContaining(['mixed-axis', 'cumulative-bars']));
  });

  it('flags rising bars as a likely running total when nobody said what they are', () => {
    const { aggregation: _, ...unsaid } = { ...MISLEADING, x: ['Jul', 'Aug', 'Sep', 'Oct'], series: [{ name: 'Revenue', values: [1, 2, 3, 4] }] };

    expect(rules(checkChart(spec(unsaid))).signals).toContain('running-total');
  });

  it('passes the stacked-by-month version with nothing to say about its title', () => {
    const r = checkChart(spec(STACKED_BY_MONTH));

    expect(r.refusals).toEqual([]);
    expect(rules(r).signals).not.toContain('title-restates-axes');
  });

  it('refuses only data that cannot be drawn honestly: a stack off its totals, a value that is not a number, two units, a waterfall of two series', () => {
    expect(rules(checkChart(spec({ ...STACKED_BY_MONTH, totals: STACKED_BY_MONTH.x.map((_, i) => (i === 0 ? 999 : null)) }))).refusals).toContain('stack-total');
    expect(rules(checkChart({ ...spec({ type: 'bar', x: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }], format: 'number' }), series: [{ name: 'A', values: [1, Number.POSITIVE_INFINITY] }] })).refusals).toContain('non-finite');
    expect(rules(checkChart(spec({ type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [1, 2], axis: 'right' }], format: 'number' }))).refusals).toContain('mixed-units');
    expect(rules(checkChart(spec({ type: 'waterfall', x: ['A', 'B'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [1, 2] }], format: 'number' }))).refusals).toContain('waterfall-series');
  });

  it('leaves a missing format, long names, thin bars and many series to the library and the model', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Northwind Regional Holdings ${i}`);
    const many = Array.from({ length: 90 }, (_, i) => `Item ${i}`);
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, values: [1, 2] }));

    expect(rules(checkChart(spec({ type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }] }))).signals).toContain('no-format');
    expect(checkChart(spec({ type: 'bar', x: names, series: [{ name: 'Spend', values: names.map(() => 1) }], format: 'number' })).refusals).toEqual([]);
    expect(checkChart(spec({ type: 'bar', x: many, series: [{ name: 'A', values: many.map(() => 1) }], format: 'number' })).refusals).toEqual([]);
    expect(chartSpecSchema.safeParse({ type: 'line', x: ['Jan', 'Feb'], series: nine, format: 'number' }).success).toBe(true);
  });

  it('asks for a finding when the title only names the axes', () => {
    expect(rules(checkChart(spec({ title: 'Revenue by month', type: 'bar', x: ['Jan', 'Feb'], series: [{ name: 'Revenue', values: [1, 2] }], format: 'currency', aggregation: 'period' }))).signals).toContain('title-restates-axes');
  });
});

describe('the library lays good charts out by default (2026-10-24)', () => {
  it('turns bars over long names horizontal on a phone, names in full and each value on its bar', () => {
    const names = ['Northwind Regional Holdings', 'Kestrel Capital Partners', 'Larkfield Construction Group', 'Other customers'];
    const s = spec({ title: 'Three customers carry half the year', type: 'bar', x: names, series: [{ name: 'Revenue', values: [1310000, 820000, 540000, 2440000] }], format: 'currency' });
    const phone = layoutChart(s, { width: 390 });

    expect(phone.facts.orientation).toBe('horizontal');
    expect(phone.facts.autoHorizontal).toBe(true);
    expect(phone.facts.shortened).toEqual([]);
    expect(phone.facts.directLabels).toBe(true);

    const texts = phone.marks.flatMap(m => (m.kind === 'text' ? [m.text] : []));

    expect(texts.join(' ')).toContain('Northwind');
    expect(texts).toContain('$1.31M');
    expect(phone.legend).toEqual([]);
  });

  it('wraps a name onto two lines before it cuts one short', () => {
    const s = spec({ title: 'Delivery leads, support trails', type: 'bar', x: ['Delivery team', 'Support desk', 'Sales team', 'Finance'], series: [{ name: 'Hours', values: [420, 120, 260, 90] }], unit: 'hours' });
    const scene = layoutChart(s, { width: 360 });

    expect(scene.facts.orientation).toBe('vertical');
    expect(scene.facts.wrapped.length).toBeGreaterThan(0);
    expect(scene.facts.shortened).toEqual([]);
  });

  it('keeps time on the x axis, thinning months rather than turning a period chart on its side', () => {
    const scene = layoutChart(spec(STACKED_BY_MONTH), { width: 320 });

    expect(scene.facts.orientation).toBe('vertical');
  });

  it('draws the P&L bridge Chris was shown as its summary plus a rescaled detail, every step readable', () => {
    const scene = layoutChart(spec(PNL_BRIDGE), { width: 390 });

    expect(scene.facts.split).toEqual({ from: 'Operating profit', to: 'Net income', steps: 4 });
    expect(scene.facts.illegible).toEqual([]);
    expect(scene.facts.shortened).toEqual([]);

    const texts = scene.marks.flatMap(m => (m.kind === 'text' ? [m.text] : []));

    expect(texts).toEqual(expect.arrayContaining(['−$4.6k', '$46k', 'Detail, rescaled: Operating profit to Net income']));
    // Values on every bar say increase and decrease by their sign: no color key.
    expect(scene.legend.map(l => l.label)).not.toContain('Increase');
  });

  it('adds up a subtotal the model left empty, and starts the bridge where asked', () => {
    const s = spec(PNL_BRIDGE);
    const whole = layoutChart(s, { width: 960 });

    expect(whole.marks.some(m => m.kind === 'text' && m.text === '$2.59M')).toBe(true);

    const tail = layoutChart(spec({ ...PNL_BRIDGE, waterfallStart: 'Operating profit' }), { width: 390 });

    expect(tail.facts.split).toBeNull();
    expect(tail.facts.illegible).toEqual([]);
    expect(tail.marks.some(m => m.kind === 'text' && m.text === '$112k')).toBe(true);
  });

  it('keeps the seven largest series and folds the rest into "Other"', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `Product ${i}`, values: [i + 1, i + 2] }));
    const { spec: folded, folded: names } = foldSeries(spec({ type: 'bar', x: ['Q1', 'Q2'], series: ten, stack: 'stack', format: 'number' }));

    expect(folded.series).toHaveLength(8);
    expect(folded.series.at(-1)).toMatchObject({ name: 'Other (3)', values: [6, 9] });
    expect(names).toEqual(['Product 0', 'Product 1', 'Product 2']);
  });

  it('names a few lines at their ends instead of in a legend', () => {
    const scene = layoutChart(spec({ title: 'Support time falls as self-serve grows', type: 'line', x: ['Jan', 'Feb', 'Mar', 'Apr'], series: [{ name: 'Self-serve', values: [10, 14, 19, 25] }, { name: 'Support', values: [30, 27, 22, 18] }], format: 'percent' }), { width: 640 });

    expect(scene.legend).toEqual([]);
    expect(scene.marks.filter(m => m.kind === 'text' && (m.text === 'Self-serve' || m.text === 'Support'))).toHaveLength(2);
  });
});

describe('the chart review the model reads (2026-10-24)', () => {
  it('says what the layout did at a phone\'s width and asks the model to judge it', () => {
    const r = reviewChart(spec(PNL_BRIDGE));

    expect(r.width).toBe(390);
    expect(r.text).toContain('390px');
    expect(r.text).toContain('rescaled (Operating profit to Net income)');
    expect(r.text).toContain('revise it once with update_artifact');
  });

  it('names values too small to read, and the analyst\'s notes', () => {
    const x = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    const tiny = spec({ title: 'One account dwarfs the rest', type: 'bar', x, series: [{ name: 'Amount', values: x.map((_, i) => (i === 0 ? 5000000 : 300)) }], format: 'currency', orientation: 'vertical' });
    const r = reviewChart(tiny);

    expect(r.facts.illegible.map(v => v.label)).toEqual(expect.arrayContaining(['B']));
    expect(r.text).toContain('Too small to read, with no label: B ($300');
    expect(reviewChart(spec(MISLEADING)).text).toContain('[mixed-axis]');
  });

  it('tells a revision it is the one revision', () => {
    expect(reviewChart(spec(STACKED_BY_MONTH), { revised: true }).text).toContain('This is your revision');
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
    const drawn = placeXLabels(x, 300 / 36, 11).drawn;

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

  it('draws a block an analyst would question, with the note; refuses only data it cannot draw honestly', () => {
    const drawn = expandChartBlocks(doc(block(MISLEADING)));

    expect(drawn.errors).toEqual([]);
    expect(drawn.warnings.join('\n')).toContain('chart block 1 [mixed-axis]');

    const refused = expandChartBlocks(doc(block({ ...STACKED_BY_MONTH, totals: STACKED_BY_MONTH.x.map((_, i) => (i === 0 ? 999 : null)) })));

    expect(refused.errors.join('\n')).toContain('chart block 1 [stack-total]');
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
