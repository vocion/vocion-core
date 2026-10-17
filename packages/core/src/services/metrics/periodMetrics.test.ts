import type { RawReading } from '@/services/team-report';
import { describe, expect, it } from 'vitest';
import { PageManifestSchema } from '@/libs/workspace/pageFields';
import { foldPeriods, summarize } from './periodMetrics';
import { lastWeeks } from './periods';

const weeks = lastWeeks(4, new Date('2026-10-17T15:00:00Z'), 'America/Los_Angeles');
const metric = {
  key: 'sqls',
  label: 'Contacts reaching SQL',
  group: 'outcome' as const,
  format: 'number' as const,
  source: { kind: 'verified' as const, connector: 'hubspot' as const, query: { object: 'contacts' as const, filter: {}, aggregate: 'count', dateField: 'sqlEnteredAt' as const } },
};
const fresh = { asOf: new Date('2026-10-17T14:50:00Z'), ageMs: 600_000, stale: false, note: null };
const read = (value: number | null): RawReading => value === null
  ? { value: null, asOf: null, freshness: { asOf: null, ageMs: null, stale: true, note: 'no source' }, sourceLabel: 'HubSpot', unavailableReason: 'No HubSpot source is connected.', unavailableKind: 'unconfigured' }
  : { value, asOf: fresh.asOf, freshness: fresh, sourceLabel: 'HubSpot', unavailableReason: null, unavailableKind: null };

describe('a figure read period by period', () => {
  it('keeps every week\'s count, oldest first, with where it came from', () => {
    const f = foldPeriods(metric, weeks, [read(3), read(5), read(4), read(2)]);

    expect(f.points.map(p => p.value)).toEqual([3, 5, 4, 2]);
    expect(f.provenance).toBe('verified');
    expect(f.sourceLabel).toBe('HubSpot');
    expect(f.unavailable).toBeNull();
  });

  it('says why when no week could be read, and never shows a zero for it', () => {
    const f = foldPeriods(metric, weeks, weeks.map(() => read(null)));

    expect(f.unavailable).toEqual({ kind: 'unconfigured', reason: 'No HubSpot source is connected.' });
    expect(summarize(f.points)).toEqual({ current: null, previous: null, usual: null, total: null });
  });
});

describe('the headline numbers', () => {
  it('reads this week to date, last week, the usual full week and the total', () => {
    const f = foldPeriods(metric, weeks, [read(3), read(5), read(4), read(2)]);

    expect(summarize(f.points)).toEqual({ current: 2, previous: 4, usual: 4, total: 14 });
  });

  it('declines a total or a usual week that would quietly skip a missing week', () => {
    const f = foldPeriods(metric, weeks, [read(null), read(5), read(4), read(2)]);

    expect(summarize(f.points)).toEqual({ current: 2, previous: 4, usual: null, total: null });
  });
});

describe('a metrics page as written', () => {
  const page = {
    slug: 'metrics',
    title: 'Metrics',
    archetype: 'metrics',
    metrics: { items: [{ key: 'sqls', label: 'Contacts reaching SQL', source: { kind: 'verified', connector: 'hubspot', query: { object: 'contacts', dateField: 'sqlEnteredAt' } } }] },
  };

  it('parses, twelve weeks and twelve months by default', () => {
    const parsed = PageManifestSchema.parse(page);

    expect(parsed.metrics?.weeks).toBe(12);
    expect(parsed.metrics?.months).toBe(12);
    expect(parsed.metrics?.items[0]?.group).toBe('outcome');
  });

  it('refuses a metrics page with no figures, and figures on any other page', () => {
    expect(PageManifestSchema.safeParse({ ...page, metrics: undefined }).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...page, archetype: 'markdown' }).success).toBe(false);
  });

  it('refuses a stage entry date on deals, and a close date on contacts', () => {
    const on = (object: string, dateField: string) => ({ ...page, metrics: { items: [{ ...page.metrics.items[0], source: { kind: 'verified', connector: 'hubspot', query: { object, dateField } } }] } });

    expect(PageManifestSchema.safeParse(on('deals', 'sqlEnteredAt')).success).toBe(false);
    expect(PageManifestSchema.safeParse(on('contacts', 'closeDate')).success).toBe(false);
    expect(PageManifestSchema.safeParse(on('deals', 'closeDate')).success).toBe(true);
  });
});
