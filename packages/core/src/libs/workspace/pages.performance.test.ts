import type { PageRow, PageStat } from './pageFields';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { applyWindow, chosenWindow, computeStat, computeTotals, groupRows, PageManifestSchema } from './pageFields';

/**
 * The Performance page's arithmetic, pinned.
 *
 * Two defects put this file here, and both were arithmetic rather than
 * taste. The page printed "$35.62 spent", "9 accepted changes" and "$1.44 per
 * accepted change", and a reader who divided got $3.96, because `avg`
 * divides by however many rows carried a figure, so the $1.44 was the spend
 * on shipped work over the EIGHT shipped requests that had a measured cost,
 * while the 9 beside it counted all nine and the $35.62 above it also held
 * the $24.12 still building. And it summed the spend on `answered` requests
 * and called that waste, which charges the factory for investigating a
 * request and honestly saying no.
 *
 * So: every figure a page prints beside a count must survive being divided
 * by it, and waste is rework: spend that produced no accepted outcome.
 */

const PAGES_DIR = join(process.cwd(), 'templates/plugins/software-factory/pages');

function manifest() {
  return PageManifestSchema.parse(parseYaml(readFileSync(join(PAGES_DIR, 'performance.yaml'), 'utf8')));
}

function statNamed(label: string): PageStat {
  const found = (manifest().stats ?? []).find(s => s.label === label);
  if (!found) {
    throw new Error(`the Performance page no longer has a stat called "${label}"`);
  }
  return found;
}

const NOW = new Date('2026-09-21T16:00:00Z');
const DAY = 86_400_000;

function row(id: number, meta: Record<string, unknown>, ageDays = 1): PageRow {
  return { id, title: `Request ${id}`, status: 'active', createdAt: new Date(NOW.getTime() - ageDays * DAY), meta };
}

/**
 * The live shape, shrunk: nine shipped requests of which EIGHT carry a
 * measured cost, one still building holding most of the spend, and answered
 * requests that cost nothing to record but did cost judgement.
 */
function liveLikeRows(): PageRow[] {
  return [
    // Shipped, with measured spend. 592 + 49 + 13 + 340 + 20 + 10 + 42 + 84 = 1150.
    row(87, { state: 'shipped', kind: 'gap', actualCents: 592, taskCount: 1, reworkCents: 0, reworkTaskCount: 0, askedAt: '2026-09-21T00:00:00Z', shippedAt: '2026-09-21T14:30:00Z' }),
    row(78, { state: 'shipped', kind: 'gap', actualCents: 49, taskCount: 1, reworkCents: 0, reworkTaskCount: 0, shippedAt: '2026-09-20T23:32:00Z' }),
    row(42, { state: 'shipped', kind: 'idea', actualCents: 13, taskCount: 1, reworkCents: 0, reworkTaskCount: 0, askedAt: '2026-09-19T18:52:00Z' }),
    row(41, { state: 'shipped', kind: 'gap', actualCents: 340, taskCount: 3, reworkCents: 0, reworkTaskCount: 2, askedAt: '2026-09-20T16:19:00Z', shippedAt: '2026-09-20T17:02:53Z' }),
    row(37, { state: 'shipped', kind: 'bug', actualCents: 20, taskCount: 4, reworkCents: 20, reworkTaskCount: 4, askedAt: '2026-09-20T20:25:00Z', shippedAt: '2026-09-20T20:37:26Z' }),
    row(36, { state: 'shipped', kind: 'bug', actualCents: 10, taskCount: 2, reworkCents: 10, reworkTaskCount: 2, askedAt: '2026-09-20T20:04:00Z', shippedAt: '2026-09-20T20:11:14Z' }),
    row(35, { state: 'shipped', kind: 'bug', actualCents: 42, taskCount: 1, reworkCents: 0, reworkTaskCount: 0, askedAt: '2026-09-20T17:47:00Z', shippedAt: '2026-09-20T23:32:03Z' }),
    row(34, { state: 'shipped', kind: 'bug', actualCents: 84, taskCount: 1, reworkCents: 0, reworkTaskCount: 0, askedAt: '2026-09-20T17:47:00Z', shippedAt: '2026-09-20T23:29:49Z' }),
    // Shipped with NO measured cost and no task. This is the row the old
    // average silently dropped out of its denominator.
    row(39, { state: 'shipped', kind: 'gap', decidedAt: '2026-09-20T19:05:00Z', askedAt: '2026-09-20T19:00:00Z', shippedAt: '2026-09-20T21:00:34Z' }),
    // Still building, and holding most of the money.
    row(40, { state: 'building', kind: 'idea', actualCents: 2412, taskCount: 5, reworkCents: 1227, reworkTaskCount: 4, decidedAt: '2026-09-20T19:57:00Z', recommendationState: 'approved' }),
    // Answered honestly. Real work, a real outcome, and not waste.
    row(33, { state: 'answered', kind: 'bug' }),
    row(31, { state: 'answered', kind: 'question' }),
    // Waiting on a person.
    row(30, { state: 'triaged', kind: 'gap', decisionCost: 15, recommendationState: 'proposed' }),
    // Old work, outside every finite window.
    row(9, { state: 'shipped', kind: 'gap', actualCents: 5000, taskCount: 1, reworkCents: 0, reworkTaskCount: 0 }, 400),
  ];
}

describe('performance: a figure and the count beside it', () => {
  const rows = applyWindow(liveLikeRows(), manifest().window, 30, NOW);

  it('divides the spend on shipped work by how many shipped, not by how many carried a figure', () => {
    // The two headline numbers, and the third a reader gets by dividing them.
    expect(computeStat(rows, statNamed('Shipped outcomes'), NOW)).toBe('9');
    expect(computeStat(rows, statNamed('Cost per shipped outcome'), NOW)).toBe('$1.28');

    const shippedSpend = rows
      .filter(r => r.meta.state === 'shipped')
      .reduce((a, r) => a + ((r.meta.actualCents as number | undefined) ?? 0), 0);

    expect(shippedSpend).toBe(1150);
    // $11.50 over 9 is $1.28, and this is the assertion the page exists to
    // keep true: numerator, denominator and printed figure agree.
    expect(`$${(Math.round(shippedSpend / 9) / 100).toFixed(2)}`).toBe('$1.28');
  });

  it('would have printed the old, unreconcilable $1.44 had the stat stayed an average', () => {
    const asAverage: PageStat = { ...statNamed('Cost per shipped outcome'), kind: 'avg' };

    // Eight of the nine shipped rows carry a cost: $11.50 over EIGHT is
    // $1.44, beside a 9, the exact number nobody could reproduce.
    expect(computeStat(rows, asAverage, NOW)).toBe('$1.44');
    expect(computeStat(rows, statNamed('Cost per shipped outcome'), NOW)).not.toBe('$1.44');
  });

  it('keeps the money additive: every group holds each request once and the totals sum to the page total', () => {
    const groups = groupRows(rows, manifest().groupBy!);
    const fields = manifest().fields!;
    const perGroup = groups.map(g => ({ label: g.label, n: g.rows.length, actual: computeTotals(g.rows, fields).actual }));
    const total = rows.reduce((a, r) => a + ((r.meta.actualCents as number | undefined) ?? 0), 0);

    expect(perGroup.reduce((a, g) => a + g.n, 0)).toBe(rows.length);
    expect(perGroup.find(g => g.label === 'shipped')?.actual).toBe('$11.50');
    expect(perGroup.find(g => g.label === 'building')?.actual).toBe('$24.12');
    // $11.50 shipped + $24.12 in flight = $35.62, the whole of it, once.
    expect(total).toBe(3562);
  });

  it('every stat with a note says what it counts, so no methodology paragraph has to', () => {
    for (const s of manifest().stats ?? []) {
      expect(s.note, `"${s.label}" has no note`).toBeTruthy();
    }
  });
});

describe('performance: rework, not answered', () => {
  const rows = applyWindow(liveLikeRows(), manifest().window, 30, NOW);

  it('charges spend that was discarded or repeated, and nothing for an honest answer', () => {
    // 0 + 0 + 0 + 0 + 20 + 10 + 0 + 0 + 1227 = 1257.
    expect(computeStat(rows, statNamed('Rework spend'), NOW)).toBe('$12.57');
  });

  it('does not charge the factory for reaching the answered outcome', () => {
    const answeredSpend: PageStat = {
      label: 'The old waste figure',
      kind: 'sum',
      field: 'meta.actualCents',
      format: 'money',
      where: { field: 'meta.state', op: 'eq', value: 'answered' },
    };

    // The old page printed this and called it waste. On this data it is zero,
    // a number that told a reader nothing while $12.57 of genuine rework
    // went unnamed.
    expect(computeStat(rows, answeredSpend, NOW)).toBe('$0.00');
    expect(computeStat(rows, statNamed('Rework spend'), NOW)).not.toBe(computeStat(rows, answeredSpend, NOW));
    expect(JSON.stringify(manifest().stats)).not.toMatch(/waste/i);
  });

  it('counts a request accepted first pass only when it had an implementation to accept', () => {
    // Nine shipped: one had no task at all and is in neither half, three of
    // the remaining eight had a task rejected or abandoned.
    expect(computeStat(rows, statNamed('Accepted first pass'), NOW)).toBe('62.5%');
  });
});

describe('performance: one window, obeyed', () => {
  it('drops work from outside the chosen span, and puts it back under all time', () => {
    const all = liveLikeRows();

    expect(applyWindow(all, manifest().window, 30, NOW)).toHaveLength(all.length - 1);
    expect(applyWindow(all, manifest().window, 'all', NOW)).toHaveLength(all.length);
    // The 400-day-old request is $50 of spend on one more shipped outcome.
    expect(computeStat(applyWindow(all, manifest().window, 'all', NOW), statNamed('Shipped outcomes'), NOW)).toBe('10');
    expect(computeStat(applyWindow(all, manifest().window, 'all', NOW), statNamed('Cost per shipped outcome'), NOW)).toBe('$6.15');
  });

  it('refuses a window the page does not offer, and honours the ones it does', () => {
    const w = manifest().window;

    expect(chosenWindow(w, '7')).toBe(7);
    expect(chosenWindow(w, 'all')).toBe('all');
    expect(chosenWindow(w, undefined)).toBe(30);
    expect(chosenWindow(w, '9999')).toBe(30);
    expect(chosenWindow(w, 'nonsense')).toBe(30);
    expect(chosenWindow(undefined, '7')).toBe('all');
  });

  it('leaves a lifetime stat alone', () => {
    const cumulative: PageStat = { label: 'Spent ever', kind: 'sum', field: 'meta.actualCents', format: 'money', lifetime: true };
    const all = liveLikeRows();

    expect(computeStat(all, cumulative, NOW)).toBe('$85.62');
    expect(computeStat(applyWindow(all, manifest().window, 30, NOW), { ...cumulative, lifetime: false }, NOW)).toBe('$35.62');
  });
});

describe('performance: what the page says when it has nothing to say', () => {
  it('reads zero rather than blank, NaN or a dash, for every stat it declares', () => {
    const empty: PageRow[] = [];
    const rendered = (manifest().stats ?? []).map(s => computeStat(empty, s, NOW));

    expect(rendered).toEqual([
      '0',
      '0 h',
      '$0.00',
      '0 min',
      '0%',
      '$0.00',
      '0',
      '0',
      '0',
      '0',
    ]);

    for (const value of rendered) {
      expect(value).not.toMatch(/NaN|Infinity|undefined|null/);
    }
  });

  it('still draws each section, so an empty quality section reads as zero rather than as absent', () => {
    const groups = [...new Set((manifest().stats ?? []).map(s => s.group ?? null))];

    expect(groups).toEqual([null, 'Quality', 'What autonomy saved']);
  });
});

describe('performance: cycle time is measured, never invented', () => {
  it('takes the median over the requests that carry both ends, and leaves the rest out', () => {
    // Of the nine shipped, seven have an ask date and a ship date.
    expect(computeStat(applyWindow(liveLikeRows(), manifest().window, 30, NOW), statNamed('Ask to ship, median'), NOW)).toBe('2 h');
  });

  it('is zero, not a guess, when nothing can be measured at all', () => {
    const noDates = [row(1, { state: 'shipped', actualCents: 100 })];

    expect(computeStat(noDates, statNamed('Ask to ship, median'), NOW)).toBe('0 h');
  });

  it('will not count a ship that precedes its ask', () => {
    const backwards = [
      row(1, { state: 'shipped', askedAt: '2026-09-20T12:00:00Z', shippedAt: '2026-09-20T10:00:00Z' }),
      row(2, { state: 'shipped', askedAt: '2026-09-20T00:00:00Z', shippedAt: '2026-09-20T04:00:00Z' }),
    ];

    expect(computeStat(backwards, statNamed('Ask to ship, median'), NOW)).toBe('4 h');
  });
});

describe('performance: autonomy stated as outcomes, not as a blend', () => {
  const rows = applyWindow(liveLikeRows(), manifest().window, 30, NOW);

  it('counts the outcomes nobody had to decide, and the ones somebody did', () => {
    expect(computeStat(rows, statNamed('Outcomes reached with no human decision'), NOW)).toBe('10');
    expect(computeStat(rows, statNamed('Outcomes that needed one'), NOW)).toBe('1');
    expect(computeStat(rows, statNamed('Still waiting on a person'), NOW)).toBe('1');
  });

  it('never averages the two into one percentage', () => {
    expect((manifest().stats ?? []).some(s => /^autonomy$/i.test(s.label))).toBe(false);
    expect((manifest().stats ?? []).filter(s => s.group === 'What autonomy saved').every(s => s.kind === 'countWhere')).toBe(true);
  });
});
