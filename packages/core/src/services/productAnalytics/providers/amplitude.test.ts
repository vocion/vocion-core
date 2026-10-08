/**
 * The Amplitude provider against recorded-shape Dashboard REST API responses:
 * what each endpoint is asked and how its answer is read, the funnel
 * arithmetic, the EU host, a 429 waited out once, Test connection, and two
 * workspaces each spending their own key pair.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const creds = vi.hoisted(() => ({ byOrg: {} as Record<string, Record<string, unknown> | null> }));
vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => creds.byOrg[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { amplitudeAnalyticsProvider } = await import('./amplitude');
const { inspectAmplitude } = await import('@/libs/sources/amplitude');

const NORTHWIND = { apiKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', secretKey: 'f0e1d2c3b4a5968778695a4b3c2d1e0f' };
const KESTREL = { apiKey: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', secretKey: '9f8e7d6c5b4a39281706f5e4d3c2b1a0' };

function source(config: Record<string, unknown> = {}): FamilySource {
  return { id: 2, slug: 'amplitude', kind: 'amplitude', config, apiTokenId: null };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function recorder(answer: (url: URL) => Response) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    return answer(u);
  });
  return { calls, fetch };
}

function basicUser(init: RequestInit): string {
  const header = (init.headers as Record<string, string>).authorization!;
  return Buffer.from(header.replace(/^Basic /, ''), 'base64').toString('utf8').split(':')[0]!;
}

const EVENTS_LIST = {
  data: [
    { non_active: false, value: 'Link Opened', totals: 300, deleted: false, flow_hidden: false, hidden: false, display: 'Link Opened' },
    { non_active: false, value: 'Document Sent', totals: 1200, deleted: false, flow_hidden: false, hidden: false, display: 'Document Sent' },
    { non_active: false, value: 'Old Event', totals: 5, deleted: true, flow_hidden: false, hidden: false, display: 'Old Event' },
  ],
};

describe('amplitude provider', () => {
  it('lists visible events busiest first, with this week\'s totals, on the EU host', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json(EVENTS_LIST));
    const p = await amplitudeAnalyticsProvider('org_nw', source({ region: 'eu' }), { fetch });

    await expect(p.listEvents(10)).resolves.toEqual([{ name: 'Document Sent', volume: 1200 }, { name: 'Link Opened', volume: 300 }]);
    expect(calls[0]!.url.origin).toBe('https://analytics.eu.amplitude.com');
    expect(calls[0]!.url.pathname).toBe('/api/2/events/list');
    expect(p.project).toBe('project with API key …8f90');
  });

  it('counts an event per week as uniques, with compact dates and the interval code', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json({ data: { series: [[40, 55]], seriesLabels: [0], xValues: ['2026-08-31', '2026-09-07'] } }));
    const p = await amplitudeAnalyticsProvider('org_nw', source(), { fetch });

    const [series] = await p.eventCounts({ events: ['Document Sent'], from: '2026-09-01', to: '2026-09-13', interval: 'week', measure: 'uniques' });

    expect(series).toEqual({ event: 'Document Sent', measure: 'uniques', interval: 'week', points: [{ date: '2026-08-31', value: 40 }, { date: '2026-09-07', value: 55 }], total: 95 });

    const q = calls[0]!.url.searchParams;

    expect(calls[0]!.url.origin).toBe('https://amplitude.com');
    expect(JSON.parse(q.get('e')!)).toEqual({ event_type: 'Document Sent' });
    expect([q.get('m'), q.get('i'), q.get('start'), q.get('end')]).toEqual(['uniques', '7', '20260901', '20260913']);
  });

  it('builds an ordered funnel from steps, with the window in seconds, and computes the shares itself', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json({
      data: [{ meta: { segmentIndex: 0 }, stepByStep: [1, 0.5, 0.25], cumulative: [1, 0.5, 0.125], cumulativeRaw: [800, 400, 100], events: ['Document Sent', 'Link Opened', 'Document Signed'] }],
    }));
    const p = await amplitudeAnalyticsProvider('org_nw', source(), { fetch });

    const funnel = await p.funnel({ steps: ['Document Sent', 'Link Opened', 'Document Signed'], from: '2026-09-01', to: '2026-09-30', windowDays: 3 });

    expect(funnel.steps).toEqual([
      { event: 'Document Sent', count: 800, fromPrevious: null, fromStart: 1 },
      { event: 'Link Opened', count: 400, fromPrevious: 0.5, fromStart: 0.5 },
      { event: 'Document Signed', count: 100, fromPrevious: 0.25, fromStart: 0.125 },
    ]);

    const q = calls[0]!.url.searchParams;

    expect(q.getAll('e').map(e => JSON.parse(e).event_type)).toEqual(['Document Sent', 'Link Opened', 'Document Signed']);
    expect([q.get('mode'), q.get('cs')]).toEqual(['ordered', String(3 * 86_400)]);
  });

  it('answers a saved funnel id with a sentence, since Amplitude builds funnels from steps', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const p = await amplitudeAnalyticsProvider('org_nw', source(), { fetch: vi.fn() });

    await expect(p.savedFunnels()).resolves.toEqual([]);
    await expect(p.funnel({ savedFunnelId: 'abc123', from: '2026-09-01', to: '2026-09-30', windowDays: 7 })).rejects.toThrow(/builds a funnel from its steps/);
  });

  it('lists cohorts that are neither archived nor hidden, with size and last computed time', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json({
      cohorts: [
        { appId: 100001, id: 'xk3p9q', name: 'Northwind power senders', description: 'Sent 10+ documents in 30 days', size: 120, lastComputed: 1_788_000_000_000, archived: false, hidden: false },
        { appId: 100001, id: 'zz0000', name: 'Old test', description: '', size: 3, lastComputed: 1_700_000_000, archived: true, hidden: false },
      ],
    }));
    const p = await amplitudeAnalyticsProvider('org_nw', source(), { fetch });

    await expect(p.cohorts()).resolves.toEqual([{ id: 'xk3p9q', name: 'Northwind power senders', description: 'Sent 10+ documents in 30 days', size: 120, updated: new Date(1_788_000_000_000).toISOString() }]);
    expect(calls[0]!.url.pathname).toBe('/api/3/cohorts');
  });

  it('waits out one 429 that says how long, and reports one that does not as a sentence', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    let n = 0;
    const { fetch } = recorder(() => (n++ === 0 ? json({}, 429, { 'retry-after': '1' }) : json(EVENTS_LIST)));
    const sleep = vi.fn(async () => {});
    const p = await amplitudeAnalyticsProvider('org_nw', source(), { fetch, sleep });

    await expect(p.listEvents(5)).resolves.toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);

    const blunt = recorder(() => json({}, 429));
    const p2 = await amplitudeAnalyticsProvider('org_nw', source(), { fetch: blunt.fetch, sleep });

    await expect(p2.listEvents(5)).rejects.toThrow(/rate limit for this project is spent/);
    expect(blunt.calls).toHaveLength(1);
  });

  it('refuses a source with no credential', async () => {
    creds.byOrg.org_empty = null;

    await expect(amplitudeAnalyticsProvider('org_empty', source())).rejects.toThrow(/no Amplitude credential/);
  });

  it('spends each workspace\'s own key pair, in sequence', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    creds.byOrg.org_kc = KESTREL;
    const { calls, fetch } = recorder(() => json(EVENTS_LIST));

    await (await amplitudeAnalyticsProvider('org_nw', source(), { fetch })).listEvents(1);
    await (await amplitudeAnalyticsProvider('org_kc', source(), { fetch })).listEvents(1);

    expect(basicUser(calls[0]!.init)).toBe(NORTHWIND.apiKey);
    expect(basicUser(calls[1]!.init)).toBe(KESTREL.apiKey);
  });
});

describe('amplitude Test connection', () => {
  it('says what the project tracks', async () => {
    const { fetch } = recorder(() => json(EVENTS_LIST));
    const result = await inspectAmplitude({ config: { region: 'us' }, credentials: NORTHWIND }, fetch);

    expect(result.authorized).toBe(true);
    expect(result.checks[0]!.detail).toBe('2 events tracked; busiest this week: Document Sent, Link Opened.');
  });

  it('reports a refused key pair without echoing it', async () => {
    const { fetch } = recorder(() => json({ error: 'Invalid' }, 401));
    const result = await inspectAmplitude({ config: {}, credentials: NORTHWIND }, fetch);

    expect(result.authorized).toBe(false);
    expect(result.error).toMatch(/refused the key pair/);
    expect(JSON.stringify(result)).not.toContain(NORTHWIND.secretKey);
  });

  it('refuses a credential missing its secret key', async () => {
    await expect(inspectAmplitude({ config: {}, credentials: { apiKey: NORTHWIND.apiKey } })).rejects.toThrow(/secret key/);
  });
});
