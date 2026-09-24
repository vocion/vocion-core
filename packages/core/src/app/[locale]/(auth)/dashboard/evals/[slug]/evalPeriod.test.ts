/**
 * The dataset page's period, as its URL carries it.
 *
 * Three things can go wrong without anyone noticing: a link whose range is bad
 * showing a filtered-looking page over every run, paging that silently drops
 * the period, and a shared "Last 7 days" link that keeps showing last week.
 */
import { describe, expect, it } from 'vitest';
import { rangeForPreset } from '@/features/scorecard/periods';
import { initialCustomRange, isStalePreset, outcomeHref, periodHref, periodQuery, readEvalPeriod, runsPageHref, withOutcome } from './evalPeriod';

const NOW = new Date(2026, 8, 24, 15, 30);

describe('readEvalPeriod', () => {
  it('shows all time when the URL names no period', () => {
    expect(readEvalPeriod({})).toEqual({ period: 'all', range: {}, problem: null });
  });

  it('reads a preset with the range the browser resolved for it', () => {
    const selection = readEvalPeriod({ period: 'last7', from: '2026-09-18T07:00:00.000Z', to: '2026-09-25T07:00:00.000Z' });

    expect(selection.period).toBe('last7');
    expect(selection.range).toEqual({ from: new Date('2026-09-18T07:00:00Z'), to: new Date('2026-09-25T07:00:00Z') });
  });

  it('resolves a hand-typed preset with no range instead of showing every run under its name', () => {
    const selection = readEvalPeriod({ period: 'last7' }, NOW);

    expect(selection.range).toEqual(rangeForPreset('last7', NOW));
  });

  it('falls back to all time and says why when the range in the link is bad', () => {
    const selection = readEvalPeriod({ period: 'custom', from: '2026-09-08', to: '2026-09-01' });

    expect(selection.period).toBe('all');
    expect(selection.range).toEqual({});
    expect(selection.problem).toContain('could not be read');
  });

  it('falls back to all time when a link\'s custom range is longer than the picker allows', () => {
    const selection = readEvalPeriod({ period: 'custom', from: '2020-01-01', to: '2026-01-01' });

    expect(selection.period).toBe('all');
    expect(selection.problem).toContain('366 days');
  });

  it('treats a range with an unknown period name as custom, not as all time', () => {
    const selection = readEvalPeriod({ period: 'fortnight', from: '2026-09-01', to: '2026-09-08' });

    expect(selection.period).toBe('custom');
    expect(selection.range.from).toEqual(new Date('2026-09-01T00:00:00Z'));
  });
});

describe('periodHref', () => {
  const range = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') };

  it('starts the new period on page 1, because page 3 of one period is not page 3 of another', () => {
    const href = periodHref('/dashboard/evals/refunds', new URLSearchParams('page=3'), 'custom', range);

    expect(href).toBe('/dashboard/evals/refunds?period=custom&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z');
  });

  it('clears the range for all time and keeps unrelated query values', () => {
    const href = periodHref('/dashboard/evals/refunds', new URLSearchParams('period=last7&from=x&to=y&page=2&tab=cases'), 'all', null);

    expect(href).toBe('/dashboard/evals/refunds?tab=cases');
  });
});

describe('runsPageHref', () => {
  it('keeps the period on the pager links', () => {
    const query = periodQuery(readEvalPeriod({ period: 'custom', from: '2026-09-01', to: '2026-09-08' })).toString();

    expect(runsPageHref('refunds', 2, query)).toBe('/dashboard/evals/refunds?period=custom&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z&page=2');
  });

  it('drops page 1 and an all-time period from the URL', () => {
    expect(runsPageHref('refunds', 1, periodQuery(readEvalPeriod({})).toString())).toBe('/dashboard/evals/refunds');
  });
});

describe('outcome links', () => {
  const lastWeek = periodQuery(readEvalPeriod({ period: 'custom', from: '2026-09-01', to: '2026-09-08' })).toString();

  it('keep the period and start on page 1', () => {
    expect(outcomeHref('refunds', lastWeek, 'errored')).toBe('/dashboard/evals/refunds?period=custom&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z&outcome=errored');
  });

  it('go back to every run when the filter is cleared', () => {
    expect(outcomeHref('refunds', '', undefined)).toBe('/dashboard/evals/refunds');
  });

  it('stay on the pager, so page 2 of errored runs is still errored runs', () => {
    expect(runsPageHref('refunds', 2, withOutcome('', 'below_threshold'))).toBe('/dashboard/evals/refunds?outcome=below_threshold&page=2');
  });

  it('survive changing the period', () => {
    const href = periodHref('/dashboard/evals/refunds', new URLSearchParams('outcome=errored&page=3'), 'all', null);

    expect(href).toBe('/dashboard/evals/refunds?outcome=errored');
  });
});

describe('isStalePreset', () => {
  it('flags a "Last 7 days" link opened a day after it was made', () => {
    const yesterday = rangeForPreset('last7', new Date(2026, 8, 23, 12));

    expect(isStalePreset('last7', yesterday.from.toISOString(), yesterday.to.toISOString(), NOW)).toBe(true);
  });

  it('leaves a preset alone when its range is still today\'s', () => {
    const today = rangeForPreset('last7', NOW);

    expect(isStalePreset('last7', today.from.toISOString(), today.to.toISOString(), NOW)).toBe(false);
  });

  it('never moves a custom range or all time', () => {
    expect(isStalePreset('custom', '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z', NOW)).toBe(false);
    expect(isStalePreset('all', null, null, NOW)).toBe(false);
  });
});

describe('initialCustomRange', () => {
  it('prefills the custom form with the last 30 days when all time is showing', () => {
    expect(initialCustomRange(null, null, NOW)).toEqual(rangeForPreset('last30', NOW));
  });
});
