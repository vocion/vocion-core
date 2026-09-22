import type { PageRow, PageStat, PageWindow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { computeStatChange, priorWindowRows } from './pageFields';

/**
 * A figure beside the one before it.
 *
 * `$1.28 per release` is nearly unreadable on its own; `$1.28 ↓ 38%` is the
 * thing a reader came for. These pin the arithmetic, because a delta shown
 * the wrong way round is worse than no delta at all — it says the factory is
 * improving while it gets worse.
 */

const NOW = new Date('2026-09-22T12:00:00Z');
const WINDOW: PageWindow = { field: 'meta.at', label: 'in the last', options: [30], default: 30 };

/** A row `daysAgo` days before NOW, carrying `cost`. */
function row(id: number, daysAgo: number, cost: number): PageRow {
  return {
    id,
    title: `r${id}`,
    status: null,
    createdAt: NOW,
    meta: { at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), cost },
  };
}

const SUM: PageStat = { label: 'Spend', kind: 'sum', field: 'meta.cost', format: 'number', hideWhenZero: false, compare: 'prior' };

describe('the period before this one', () => {
  it('is the same span, ending where the window begins', () => {
    const rows = [row(1, 5, 10), row(2, 40, 10), row(3, 70, 10)];

    // 30-day window covers 0-30 days ago; its prior period is 30-60, so the
    // 70-day-old row belongs to neither. "Everything older" would have made a
    // factory running for a year always look like it was improving.
    expect(priorWindowRows(rows, WINDOW, 30, NOW).map(r => r.id)).toEqual([2]);
  });

  it('excludes a row with no readable date from both periods', () => {
    const undated: PageRow = { id: 9, title: 'x', status: null, createdAt: NOW, meta: { cost: 5 } };

    expect(priorWindowRows([undated], WINDOW, 30, NOW)).toEqual([]);
  });
});

describe('a figure against the one before it', () => {
  it('says how far it moved, and which way', () => {
    // 100 this period, 200 the period before: half the spend.
    const rows = [row(1, 5, 100), row(2, 40, 200)];
    const change = computeStatChange(rows, SUM, WINDOW, 30, NOW)!;

    expect(change.value).toBe('100');
    expect(change.prior).toBe('200');
    expect(change.percent).toBe(-50);
    expect(change.direction).toBe('down');
  });

  it('judges the move only where the page said which way is good', () => {
    const rows = [row(1, 5, 100), row(2, 40, 200)];

    // Cost falling is good; quality falling is not, and arithmetic cannot
    // tell them apart — the page has to say.
    expect(computeStatChange(rows, { ...SUM, goodWhen: 'down' }, WINDOW, 30, NOW)!.good).toBe(true);
    expect(computeStatChange(rows, { ...SUM, goodWhen: 'up' }, WINDOW, 30, NOW)!.good).toBe(false);
    expect(computeStatChange(rows, SUM, WINDOW, 30, NOW)!.good).toBeNull();
  });

  it('shows no percentage when there was nothing to compare against', () => {
    // "Up from nothing" is infinite, not 100%. The figures still show.
    const change = computeStatChange([row(1, 5, 100)], SUM, WINDOW, 30, NOW)!;

    expect(change.value).toBe('100');
    expect(change.prior).toBe('0');
    expect(change.percent).toBeNull();
    expect(change.direction).toBe('up');
  });

  it('calls an unchanged figure flat, and judges it neither way', () => {
    const change = computeStatChange([row(1, 5, 50), row(2, 40, 50)], { ...SUM, goodWhen: 'down' }, WINDOW, 30, NOW)!;

    expect(change.percent).toBe(0);
    expect(change.direction).toBe('flat');
    expect(change.good).toBeNull();
  });

  it('compares nothing without a period to compare', () => {
    const rows = [row(1, 5, 100), row(2, 40, 200)];

    expect(computeStatChange(rows, SUM, undefined, 30, NOW)).toBeNull();
    expect(computeStatChange(rows, SUM, WINDOW, 'all', NOW)).toBeNull();
    expect(computeStatChange(rows, { ...SUM, compare: undefined }, WINDOW, 30, NOW)).toBeNull();
  });

  it('carries the format through to both figures', () => {
    const money: PageStat = { ...SUM, format: 'money' };
    const change = computeStatChange([row(1, 5, 1280), row(2, 40, 2000)], money, WINDOW, 30, NOW)!;

    expect(change.value).toBe('$12.80');
    expect(change.prior).toBe('$20.00');
    expect(change.percent).toBe(-36);
  });
});
