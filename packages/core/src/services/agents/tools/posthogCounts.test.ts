/**
 * posthog_event_counts — the properties that make the structured read of the
 * PostHog daily mirror trustworthy: sums are over stored aggregates, the
 * window is resolved on the server clock, missing days are named rather than
 * hidden inside a smaller number, and the tool is source-gated and org-isolated.
 */
import type { RuntimeContext } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, knowledgeDocumentSchema } = await import('@/models/Schema');
const { eventCountsForScope, posthogCountTools } = await import('./posthogCounts');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_posthog_fixture';
const OTHER_ORG = 'org_other_fixture';
const NOW = new Date('2026-09-20T10:00:00.000Z');

function ctxFor(orgId: string, sources: string[] = ['posthog'], allowed?: string[]): RuntimeContext {
  return {
    orgId,
    userId: 'test-user',
    agentSlug: 'analytics-planner',
    connectorSources: sources,
    ...(allowed ? { allowedSourceSlugs: allowed } : {}),
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Day = {
  date: string;
  product: string;
  events: Record<string, { count: number; uniques: number }>;
  totalEvents: number;
  activeUsers: number;
  exceptions?: number;
  errorIssues?: number | null;
  errorTracking?: 'read' | 'unavailable' | 'off';
};

async function seedSource(orgId: string, slug: string, lastSyncedAt: Date | null = NOW) {
  const [row] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug,
    kind: 'plugin',
    configJson: { _connector: 'posthog' },
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
  }).returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedDay(orgId: string, sourceId: number, day: Day) {
  await db.insert(knowledgeDocumentSchema).values({
    orgId,
    sourceId,
    externalId: `posthog:4242:${day.date}`,
    title: `PostHog · ${day.product} · ${day.date}`,
    contentHash: `hash-${sourceId}-${day.date}`,
    metadata: {
      kind: 'analytics-daily',
      product: day.product,
      project: day.product,
      projectId: '4242',
      date: day.date,
      events: day.events,
      totalEvents: day.totalEvents,
      activeUsers: day.activeUsers,
      exceptions: day.exceptions ?? 0,
      exceptionUsers: 0,
      errorIssues: day.errorIssues ?? null,
      errorOccurrences: null,
      errorTracking: day.errorTracking ?? (day.errorIssues == null ? 'unavailable' : 'read'),
    },
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterEach(() => vi.useRealTimers());

describe('gating', () => {
  it('is absent without a posthog source in scope, and present with one', () => {
    expect(posthogCountTools(ctxFor(ORG, ['hubspot'])).map(t => t.name)).toEqual([]);
    expect(posthogCountTools(ctxFor(ORG, ['posthog-send'])).map(t => t.name)).toEqual(['posthog_event_counts']);
  });

  it('is absent when the per-user ACL allows no posthog source', () => {
    expect(posthogCountTools(ctxFor(ORG, ['posthog'], ['hubspot'])).map(t => t.name)).toEqual([]);
  });

  it('is built into the domain tool set through the registry', () => {
    const names = buildDomainTools(ctxFor(ORG)).map(t => t.name);

    expect(names).toContain('posthog_event_counts');
    expect(buildDomainTools(ctxFor(ORG, ['web'])).map(t => t.name)).not.toContain('posthog_event_counts');
  });
});

describe('summing the mirror', () => {
  it('adds the last seven whole days up per event, names the days that are missing, and reports the errors line', async () => {
    const source = await seedSource(ORG, 'posthog');
    await seedDay(ORG, source, { date: '2026-09-19', product: 'send', events: { 'Document Sent': { count: 120, uniques: 45 }, 'Link Opened': { count: 300, uniques: 210 } }, totalEvents: 1204, activeUsers: 260, exceptions: 3, errorIssues: 2 });
    await seedDay(ORG, source, { date: '2026-09-18', product: 'send', events: { 'Document Sent': { count: 90, uniques: 40 }, 'Link Opened': { count: 200, uniques: 150 } }, totalEvents: 800, activeUsers: 200, exceptions: 1, errorIssues: 1 });
    // Older than the window: must not be counted.
    await seedDay(ORG, source, { date: '2026-09-01', product: 'send', events: { 'Document Sent': { count: 999, uniques: 999 } }, totalEvents: 9999, activeUsers: 999 });
    // Today is still being counted upstream and is never in the mirror; a doc
    // for it would be a bug, but the window must exclude it regardless.
    await seedDay(ORG, source, { date: '2026-09-20', product: 'send', events: { 'Document Sent': { count: 5, uniques: 5 } }, totalEvents: 5, activeUsers: 5 });

    const out = await eventCountsForScope(ctxFor(ORG), { days: 7 });

    expect(out).toMatchObject({
      from: '2026-09-13',
      to_exclusive: '2026-09-20',
      days_requested: 7,
      days_covered: 2,
      days_missing: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'],
      sources_read: ['posthog'],
      as_of: NOW.toISOString(),
      totals: { events: 2004, active_user_days: 460 },
      errors: { exception_events: 4, issues_active_day_sum: 3, days_without_error_tracking: 0 },
      unknown_events: [],
    });
    expect('events' in out && out.events).toEqual([
      { event: 'Link Opened', count: 500, unique_user_days: 360, days_seen: 2 },
      { event: 'Document Sent', count: 210, unique_user_days: 85, days_seen: 2 },
    ]);
  });

  it('narrows to the events and product asked for, and names events the mirror never saw', async () => {
    // Two products are two sources over the same project, sharing the credential.
    const send = await seedSource(ORG, 'posthog-send');
    const sign = await seedSource(ORG, 'posthog-sign');
    await seedDay(ORG, send, { date: '2026-09-19', product: 'send', events: { 'Document Sent': { count: 120, uniques: 45 }, 'Link Opened': { count: 300, uniques: 210 } }, totalEvents: 1204, activeUsers: 260 });
    await seedDay(ORG, sign, { date: '2026-09-19', product: 'sign', events: { 'Document Signed': { count: 7, uniques: 7 } }, totalEvents: 7, activeUsers: 7 });

    const out = await eventCountsForScope(ctxFor(ORG, ['posthog-send', 'posthog-sign']), { days: 7, events: ['document sent', 'Plan Upgraded'], product: 'Send' });

    expect('events' in out && out.events).toEqual([{ event: 'Document Sent', count: 120, unique_user_days: 45, days_seen: 1 }]);
    expect(out).toMatchObject({ product: 'Send', totals: { events: 1204 }, unknown_events: ['Plan Upgraded'] });
  });

  it('counts days without the error tracking API separately from days with none active', async () => {
    const source = await seedSource(ORG, 'posthog');
    await seedDay(ORG, source, { date: '2026-09-19', product: 'send', events: {}, totalEvents: 10, activeUsers: 3, errorIssues: null, errorTracking: 'unavailable' });
    await seedDay(ORG, source, { date: '2026-09-18', product: 'send', events: {}, totalEvents: 10, activeUsers: 3, errorIssues: 0, errorTracking: 'read' });

    const out = await eventCountsForScope(ctxFor(ORG), { days: 7 });

    expect(out).toMatchObject({ errors: { issues_active_day_sum: 0, days_without_error_tracking: 1 } });
  });

  it('answers with no_posthog_source when nothing is connected, rather than a zero', async () => {
    const out = await eventCountsForScope(ctxFor(ORG), { days: 7 });

    expect(out).toMatchObject({ error: 'no_posthog_source' });
  });
});

describe('isolation', () => {
  it('never reads another org\'s days, and honours the per-user ACL', async () => {
    const mine = await seedSource(ORG, 'posthog');
    const restricted = await seedSource(ORG, 'posthog-internal');
    const theirs = await seedSource(OTHER_ORG, 'posthog');
    await seedDay(ORG, mine, { date: '2026-09-19', product: 'send', events: { 'Document Sent': { count: 1, uniques: 1 } }, totalEvents: 1, activeUsers: 1 });
    await seedDay(ORG, restricted, { date: '2026-09-19', product: 'internal', events: { 'Document Sent': { count: 10, uniques: 10 } }, totalEvents: 10, activeUsers: 10 });
    await seedDay(OTHER_ORG, theirs, { date: '2026-09-19', product: 'send', events: { 'Document Sent': { count: 100, uniques: 100 } }, totalEvents: 100, activeUsers: 100 });

    const all = await eventCountsForScope(ctxFor(ORG, ['posthog', 'posthog-internal']), { days: 7 });
    const narrowed = await eventCountsForScope(ctxFor(ORG, ['posthog', 'posthog-internal'], ['posthog']), { days: 7 });

    expect(all).toMatchObject({ totals: { events: 11 }, sources_read: ['posthog', 'posthog-internal'] });
    expect(narrowed).toMatchObject({ totals: { events: 1 }, sources_read: ['posthog'] });
  });

  it('returns JSON through the tool, for the model to synthesize', async () => {
    const source = await seedSource(ORG, 'posthog');
    await seedDay(ORG, source, { date: '2026-09-19', product: 'send', events: { 'Document Sent': { count: 1, uniques: 1 } }, totalEvents: 1, activeUsers: 1 });
    const [toolInstance] = posthogCountTools(ctxFor(ORG)) as unknown as Array<{ invoke: (input: Record<string, unknown>) => Promise<string> }>;

    const raw = await toolInstance!.invoke({ days: 1 });

    expect(JSON.parse(raw)).toMatchObject({ from: '2026-09-19', days_covered: 1, totals: { events: 1 } });
  });
});
