/**
 * The PostHog connector turns Query API result sets into one document per day
 * and never anything finer. These tests pin the properties the analytics
 * planner and the measure layer lean on: the window a run reads (full,
 * incremental, backfill, floor), the day chunking of the HogQL calls, the
 * zero-filled table and its metadata, that a re-sync of the same day rewrites
 * the same document, and that Test connection turns a 401 into a sentence.
 *
 * Fixture cast: Northwind's "Send" product, fictional throughout.
 */
import type { SourceContext } from '@/libs/sources/types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectInputError } from '@/libs/sources/inspect';
import { inspectPosthog, posthogConnector } from '@/libs/sources/posthog';

const NOW = new Date('2026-09-20T10:00:00.000Z');
const CREDS = { apiKey: 'phx_fixture_key_0001', host: 'https://us.posthog.com', projectId: '4242' };
const SEND_EVENTS = ['Document Sent', 'Link Opened', 'Document Signed'];

function res(status: number, body: unknown): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Call = { url: string; body: Record<string, unknown> | null };

/**
 * What one query call asked for, read back off the recorded fetch.
 * @param call - One recorded fetch.
 */
function queryOf(call: Call): Record<string, unknown> {
  return (call.body?.query ?? {}) as Record<string, unknown>;
}

/**
 * A PostHog double. Breakdown rows are produced from `counts` — keyed
 * `day|event` — for whatever range a statement asks about, so the same double
 * answers a one-chunk run and a three-chunk one.
 * @param opts - Which endpoints answer what.
 * @param opts.counts - `day|event` → [count, uniques].
 * @param opts.totals - `day` → [count, uniques].
 * @param opts.definitions - Event definition names, or a status to fail with.
 * @param opts.issues - Issue aggregates per day, or a status to fail with.
 * @param opts.project - Status for the project read.
 */
function posthogFetch(opts: {
  counts?: Record<string, [number, number]>;
  totals?: Record<string, [number, number]>;
  definitions?: string[] | number;
  issues?: Record<string, Array<{ occurrences: number }>> | number;
  project?: number;
} = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ url: String(url), body });
    const target = String(url);
    if (/\/api\/projects\/4242\/$/.test(target)) {
      return opts.project && opts.project !== 200
        ? res(opts.project, { detail: opts.project === 401 ? 'Invalid personal API key.' : 'no' })
        : res(200, { id: 4242, name: 'Northwind Send', timezone: 'America/Los_Angeles' });
    }
    if (target.includes('/event_definitions/')) {
      if (typeof opts.definitions === 'number') {
        return res(opts.definitions, { detail: 'scope' });
      }
      const names = opts.definitions ?? [...SEND_EVENTS, '$autocapture', '$pageview', '$exception'];
      return res(200, { count: names.length, next: null, results: names.map((name, i) => ({ id: `def-${i}`, name })) });
    }
    if (target.endsWith('/query/')) {
      const query = (body?.query ?? {}) as { kind?: string; query?: string; values?: Record<string, unknown>; dateRange?: { date_from?: string } };
      if (query.kind === 'ErrorTrackingQuery') {
        if (typeof opts.issues === 'number') {
          return res(opts.issues, { detail: 'Unknown query kind' });
        }
        const day = query.dateRange?.date_from ?? '';
        const issues = opts.issues?.[day] ?? [];
        return res(200, { results: issues.map((issue, i) => ({ id: `issue-${i}`, name: 'redacted', aggregations: issue })) });
      }
      const from = String(query.values?.from ?? '').slice(0, 10);
      const to = String(query.values?.to ?? '').slice(0, 10);
      const inRange = (day: string) => day >= from && day < to;
      if (query.query?.includes('event, count()')) {
        const rows = Object.entries(opts.counts ?? {})
          .filter(([key]) => inRange(key.split('|')[0]!))
          .map(([key, [count, uniques]]) => {
            const [day, event] = key.split('|');
            return [`${day}T00:00:00-07:00`, event, count, uniques];
          });
        return res(200, { columns: ['day', 'event', 'total', 'uniques'], results: rows });
      }
      const rows = Object.entries(opts.totals ?? {})
        .filter(([day]) => inRange(day))
        .map(([day, [count, uniques]]) => [`${day}T00:00:00-07:00`, count, uniques]);
      return res(200, { columns: ['day', 'total', 'uniques'], results: rows });
    }
    return res(404, 'Not found.');
  });
  return { fetchMock, calls };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

function ctx(config: Record<string, unknown>, since?: Date | null, onProgress?: SourceContext['onProgress']): SourceContext {
  return { sourceId: 1, orgId: 'org_fixture', config, credentials: CREDS, since: since ?? null, onProgress };
}

/**
 * The HogQL calls a run made, in order.
 * @param calls - Every recorded fetch.
 */
function hogqlCalls(calls: Call[]) {
  return calls.filter(call => queryOf(call).kind === 'HogQLQuery');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('posthogConnector', () => {
  it('registers as an ingesting apikey connector with a Test connection step', () => {
    expect(posthogConnector.slug).toBe('posthog');
    expect(posthogConnector.name).toBe('PostHog');
    expect(posthogConnector.authKind).toBe('apikey');
    expect(posthogConnector.syncless).toBeUndefined();
    expect(posthogConnector.inspect).toBeTypeOf('function');
    expect(posthogConnector.inspectNote).toMatch(/Nothing is saved/);
  });

  it('refuses to sync without a credential, naming where to connect one', async () => {
    await expect(collect(posthogConnector.sync({ ...ctx({}), credentials: undefined })))
      .rejects
      .toThrow(/No PostHog personal API key.*Connectors page/);
  });

  it('refuses the public project token before making a call', async () => {
    const { fetchMock } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(posthogConnector.sync({ ...ctx({}), credentials: { ...CREDS, apiKey: 'phc_public_token_0001' } })))
      .rejects
      .toThrow(/project token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the window a run reads', () => {
  it('reads historyDays of whole days on a full run, ending yesterday', async () => {
    const { fetchMock, calls } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 })));

    expect(docs.map(d => d.metadata?.date)).toEqual([
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
    ]);

    const [breakdown] = hogqlCalls(calls);

    expect(queryOf(breakdown!).values).toMatchObject({ from: '2026-09-13 00:00:00', to: '2026-09-20 00:00:00' });
  });

  it('re-reads the trailing windowDays on an incremental run even when the watermark is recent', async () => {
    const { fetchMock, calls } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, windowDays: 7 }, new Date('2026-09-19T03:00:00.000Z'))));

    expect(queryOf(hogqlCalls(calls)[0]!).values).toMatchObject({ from: '2026-09-13 00:00:00', to: '2026-09-20 00:00:00' });
  });

  it('backfills from the day before an old watermark, so a gap in syncing is filled', async () => {
    const { fetchMock, calls } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, windowDays: 7 }, new Date('2026-08-30T22:00:00.000Z'))));

    expect(queryOf(hogqlCalls(calls)[0]!).values).toMatchObject({ from: '2026-08-29 00:00:00' });
    expect(docs[0]!.metadata?.date).toBe('2026-08-29');
    expect(docs).toHaveLength(22);
  });

  it('never reads further back than historyDays, whatever the watermark says', async () => {
    const { fetchMock, calls } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 10 }, new Date('2026-01-01T00:00:00.000Z'))));

    expect(queryOf(hogqlCalls(calls)[0]!).values).toMatchObject({ from: '2026-09-10 00:00:00' });
  });
});

describe('day chunking of the Query API calls', () => {
  it('splits a 90-day full run into three statements per query, not ninety', async () => {
    const { fetchMock, calls } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 90, errorTracking: false })));

    const statements = hogqlCalls(calls);

    expect(docs).toHaveLength(90);
    // Two statements (breakdown + totals) per 31-day chunk: 31 + 31 + 28.
    expect(statements).toHaveLength(6);
    expect(statements.map(call => (queryOf(call).values as Record<string, string>).from)).toEqual([
      '2026-06-22 00:00:00',
      '2026-06-22 00:00:00',
      '2026-07-23 00:00:00',
      '2026-07-23 00:00:00',
      '2026-08-23 00:00:00',
      '2026-08-23 00:00:00',
    ]);
    // No error tracking calls when the workspace turned it off.
    expect(calls.filter(call => queryOf(call).kind === 'ErrorTrackingQuery')).toHaveLength(0);
  });

  it('binds event names and the product as placeholders, never as literals in the statement', async () => {
    const { fetchMock, calls } = posthogFetch();
    vi.stubGlobal('fetch', fetchMock);

    await collect(posthogConnector.sync(ctx({ events: ['Document Sent', 'Link Opened'], product: 'send\'; DROP', historyDays: 7 })));

    const breakdown = queryOf(hogqlCalls(calls)[0]!);

    expect(breakdown.query).toContain('event IN {events}');
    expect(breakdown.query).toContain('properties.product = {product}');
    expect(breakdown.query).not.toContain('Document Sent');
    expect(breakdown.query).not.toContain('DROP');
    expect(breakdown.values).toMatchObject({ events: ['Document Sent', 'Link Opened', '$exception'], product: 'send\'; DROP' });
  });
});

describe('the daily document', () => {
  const counts = {
    '2026-09-19|Document Sent': [120, 45] as [number, number],
    '2026-09-19|Link Opened': [300, 210] as [number, number],
    '2026-09-19|$exception': [3, 2] as [number, number],
    '2026-09-18|Document Sent': [90, 40] as [number, number],
  };
  const totals = { '2026-09-19': [1204, 260] as [number, number], '2026-09-18': [800, 200] as [number, number] };
  const issues = { '2026-09-19': [{ occurrences: 2 }, { occurrences: 1 }] };

  it('writes one document per day, titled by project and day, with a zero-filled table and totals', async () => {
    const { fetchMock } = posthogFetch({ counts, totals, issues });
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, projectName: 'Send', product: 'send', historyDays: 7 })));
    const day = docs.find(d => d.metadata?.date === '2026-09-19')!;

    expect(day.externalId).toBe('posthog:4242:2026-09-19');
    expect(day.title).toBe('PostHog · Send · 2026-09-19');
    expect(day.content).toContain('| Document Sent | 120 | 45 |');
    expect(day.content).toContain('| Link Opened | 300 | 210 |');
    // An event with no rows that day is a zero, not a missing row.
    expect(day.content).toContain('| Document Signed | 0 | 0 |');
    expect(day.content).toContain('Totals for the day: 1204 events · 260 active users.');
    expect(day.content).toContain('Errors: 3 $exception events · 2 users affected · 2 issues active (3 occurrences, error tracking API).');
    expect(day.content).toContain('aggregates only');
    // $exception is the Errors line, never a table row the workspace did not ask for.
    expect(day.content).not.toContain('| $exception |');
    expect(day.metadata).toMatchObject({
      kind: 'analytics-daily',
      product: 'send',
      project: 'Send',
      projectId: '4242',
      date: '2026-09-19',
      events: {
        'Document Sent': { count: 120, uniques: 45 },
        'Link Opened': { count: 300, uniques: 210 },
        'Document Signed': { count: 0, uniques: 0 },
      },
      totalEvents: 1204,
      activeUsers: 260,
      exceptions: 3,
      exceptionUsers: 2,
      errorIssues: 2,
      errorOccurrences: 3,
      errorTracking: 'read',
    });
    expect(day.lastModifiedAt).toEqual(new Date('2026-09-20T00:00:00.000Z'));
  });

  it('writes a day PostHog returned nothing for as zeros, so the mirror has no holes', async () => {
    const { fetchMock } = posthogFetch({ counts, totals });
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 })));
    const quiet = docs.find(d => d.metadata?.date === '2026-09-15')!;

    expect(quiet.content).toContain('Totals for the day: 0 events · 0 active users.');
    expect(quiet.metadata).toMatchObject({ totalEvents: 0, events: { 'Document Sent': { count: 0, uniques: 0 } } });
  });

  it('carries nothing user-level: no ids, no properties, no messages', async () => {
    const { fetchMock } = posthogFetch({ counts, totals, issues });
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 })));

    for (const doc of docs) {
      expect(doc.content).not.toMatch(/distinct_id|person_id|redacted|@/);
      expect(Object.keys(doc.metadata ?? {})).not.toContain('issues');
    }
  });

  it('rewrites the same document on a re-sync of the same day', async () => {
    const first = posthogFetch({ counts, totals, issues });
    vi.stubGlobal('fetch', first.fetchMock);
    const before = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 })));

    const second = posthogFetch({ counts, totals, issues });
    vi.stubGlobal('fetch', second.fetchMock);
    const after = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 }, new Date('2026-09-19T12:00:00.000Z'))));

    const day = (docs: IngestDoc[]) => docs.find(d => d.externalId === 'posthog:4242:2026-09-19')!;

    expect(day(after).externalId).toBe(day(before).externalId);
    expect(day(after).content).toBe(day(before).content);
    expect(day(after).metadata).toEqual(day(before).metadata);
  });

  it('falls back to the product, then the project id, for the title', async () => {
    const { fetchMock } = posthogFetch({ totals });
    vi.stubGlobal('fetch', fetchMock);

    const byProduct = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, product: 'send', historyDays: 7 })));
    const byId = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 })));

    expect(byProduct[0]!.title).toBe('PostHog · send · 2026-09-13');
    expect(byId[0]!.title).toBe('PostHog · project 4242 · 2026-09-13');
  });
});

describe('the events counted when the workspace pins none', () => {
  it('reads the project\'s event definitions, drops PostHog\'s $ plumbing but keeps $pageview', async () => {
    const { fetchMock, calls } = posthogFetch({ definitions: ['Link Opened', '$autocapture', 'Document Sent', '$pageview', '$exception', '$feature_flag_called'] });
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(posthogConnector.sync(ctx({ historyDays: 7 })));

    expect(calls.some(call => call.url.includes('/event_definitions/'))).toBe(true);
    expect(Object.keys(docs[0]!.metadata!.events as Record<string, unknown>)).toEqual(['$pageview', 'Document Sent', 'Link Opened']);
  });

  it('names the fix when the definitions cannot be read', async () => {
    const { fetchMock } = posthogFetch({ definitions: 403 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(posthogConnector.sync(ctx({ historyDays: 7 })))).rejects.toThrow(/List the events to count under `events`/);
  });
});

describe('error tracking', () => {
  it('skips issue counts after the first refusal, says so in the document, and does not count it as a failure', async () => {
    const { fetchMock, calls } = posthogFetch({ issues: 400 });
    vi.stubGlobal('fetch', fetchMock);
    const progress: Array<{ kind: string; message?: string }> = [];

    const docs = await collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 }, null, e => progress.push(e))));

    expect(calls.filter(call => queryOf(call).kind === 'ErrorTrackingQuery')).toHaveLength(1);
    expect(docs.every(d => d.content.includes('Issue counts skipped: this PostHog does not expose the error tracking API.'))).toBe(true);
    expect(docs[0]!.metadata).toMatchObject({ errorIssues: null, errorTracking: 'unavailable' });
    expect(progress.filter(e => e.kind === 'error')).toHaveLength(0);
    expect(progress.some(e => e.kind === 'skipped' && /error tracking API not read/.test(e.message ?? ''))).toBe(true);
  });
});

describe('a failed range', () => {
  it('aborts the run rather than writing a run of zero days', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/query/') ? res(500, 'boom') : res(200, {}))));

    await expect(collect(posthogConnector.sync(ctx({ events: SEND_EVENTS, historyDays: 7 })))).rejects.toThrow(/event counts for 2026-09-13\.\.2026-09-20 failed/);
  });
});

describe('Test connection', () => {
  it('asks for a usable credential before probing', async () => {
    await expect(posthogConnector.inspect!({ config: {}, credentials: { apiKey: 'phc_public_token_0001', host: CREDS.host, projectId: '4242' }, options: {} }))
      .rejects
      .toThrow(InspectInputError);
  });

  it('turns a 401 into one failed auth check and stops there', async () => {
    const { fetchMock, calls } = posthogFetch({ project: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const inspection = await inspectPosthog({ config: {}, credentials: CREDS, now: NOW });

    expect(inspection).toMatchObject({ reachable: true, authorized: false });
    expect(inspection.checks.map(c => c.key)).toEqual(['auth']);
    expect(inspection.checks[0]!.detail).toMatch(/rejected the personal API key[\s\S]*Invalid personal API key/);
    expect(calls).toHaveLength(1);
  });

  it('reports the project, the events, one day of counts and the error tracking API on a good key', async () => {
    const { fetchMock } = posthogFetch({
      totals: { '2026-09-19': [1204, 260] },
      issues: { '2026-09-19': [{ occurrences: 5 }] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const inspection = await inspectPosthog({ config: { product: 'send' }, credentials: CREDS, now: NOW });

    expect(inspection).toMatchObject({ reachable: true, authorized: true });
    expect(inspection.checks.map(c => c.key)).toEqual(['auth', 'events', 'query', 'error_tracking']);
    expect(inspection.checks.every(c => c.ok)).toBe(true);
    expect(inspection.checks[0]!.detail).toContain('Northwind Send');
    expect(inspection.checks[1]!.detail).toMatch(/counts 4 of them/);
    expect(inspection.checks[2]!.detail).toBe('Yesterday (2026-09-19): 1204 events · 260 active users for product send.');
    expect(inspection.checks[3]!.detail).toMatch(/1 issues active, 5 occurrences/);
    expect(inspection.note).toMatch(/Nothing was saved/);
  });

  it('marks the error tracking check as not exposed without failing the connection', async () => {
    const { fetchMock } = posthogFetch({ issues: 400 });
    vi.stubGlobal('fetch', fetchMock);

    const inspection = await inspectPosthog({ config: { events: SEND_EVENTS }, credentials: CREDS, now: NOW });

    expect(inspection.authorized).toBe(true);

    const errorTracking = inspection.checks.find(c => c.key === 'error_tracking')!;

    expect(errorTracking.ok).toBe(false);
    expect(errorTracking.detail).toMatch(/skip issue counts, and say so/);
    expect(inspection.checks.find(c => c.key === 'events')!.detail).toMatch(/3 listed in the source config/);
  });
});
