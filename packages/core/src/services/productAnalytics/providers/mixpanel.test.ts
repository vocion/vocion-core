/**
 * The Mixpanel provider against recorded-shape Query API responses: what each
 * endpoint is asked and how its answer is read, the funnel arithmetic, the
 * region hosts, a 429 waited out once, Test connection, and two workspaces
 * each spending their own service account.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const creds = vi.hoisted(() => ({ byOrg: {} as Record<string, Record<string, unknown> | null> }));
vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => creds.byOrg[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { mixpanelAnalyticsProvider, sumByWeek, weekStart } = await import('./mixpanel');
const { inspectMixpanel } = await import('@/libs/sources/mixpanel');

const NORTHWIND = { username: 'northwind-reader.1a2b3c.mp-service-account', secret: 'nw-fixture-secret-0001' };
const KESTREL = { username: 'kestrel-reader.4d5e6f.mp-service-account', secret: 'kc-fixture-secret-0002' };

function source(config: Record<string, unknown> = { projectId: '2000001', region: 'us' }): FamilySource {
  return { id: 1, slug: 'mixpanel', kind: 'mixpanel', config, apiTokenId: null };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

type Call = { url: URL; init: RequestInit };

function recorder(answer: (url: URL) => Response) {
  const calls: Call[] = [];
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

describe('mixpanel provider', () => {
  it('reads top event names, scoped to the project, on the region host', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json(['Document Sent', 'Link Opened', 'Document Signed']));
    const p = await mixpanelAnalyticsProvider('org_nw', source({ projectId: '2000001', region: 'eu' }), { fetch });

    await expect(p.listEvents(2)).resolves.toEqual([{ name: 'Document Sent', volume: null }, { name: 'Link Opened', volume: null }]);
    expect(calls[0]!.url.origin).toBe('https://eu.mixpanel.com');
    expect(calls[0]!.url.pathname).toBe('/api/query/events/names');
    expect(calls[0]!.url.searchParams.get('project_id')).toBe('2000001');
    expect(p.projectUrl).toBe('https://eu.mixpanel.com/project/2000001');
  });

  it('counts an event per day, and sums days into Monday-dated weeks', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json({
      data: { series: ['2026-09-06', '2026-09-07', '2026-09-08'], values: { 'Document Sent': { '2026-09-06': 4, '2026-09-07': 10, '2026-09-08': 6 } } },
      legend_size: 1,
    }));
    const p = await mixpanelAnalyticsProvider('org_nw', source(), { fetch });

    const [daily] = await p.eventCounts({ events: ['Document Sent'], from: '2026-09-06', to: '2026-09-08', interval: 'day', measure: 'total' });

    expect(daily).toEqual({ event: 'Document Sent', measure: 'total', interval: 'day', points: [{ date: '2026-09-06', value: 4 }, { date: '2026-09-07', value: 10 }, { date: '2026-09-08', value: 6 }], total: 20 });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toMatchObject({ event: 'Document Sent', from_date: '2026-09-06', to_date: '2026-09-08', unit: 'day', type: 'general' });

    const [weekly] = await p.eventCounts({ events: ['Document Sent'], from: '2026-09-06', to: '2026-09-08', interval: 'week', measure: 'total' });

    // 2026-09-06 is a Sunday: it belongs to the week of Monday 31 August.
    expect(weekly!.points).toEqual([{ date: '2026-08-31', value: 4 }, { date: '2026-09-07', value: 16 }]);
    await expect(p.eventCounts({ events: ['Document Sent'], from: '2026-09-06', to: '2026-09-08', interval: 'week', measure: 'uniques' })).rejects.toThrow(/per day or per month/);
  });

  it('dates weeks by their Monday', () => {
    expect(weekStart('2026-09-10')).toBe('2026-09-07');
    expect(weekStart('2026-09-07')).toBe('2026-09-07');
    expect(sumByWeek([])).toEqual([]);
  });

  it('reads a saved funnel by id, summing buckets and computing the shares itself', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder((url) => {
      if (url.pathname.endsWith('/funnels/list')) {
        return json([{ funnel_id: 7001, name: 'Send to sign' }]);
      }
      return json({
        meta: { dates: ['2026-09-01'] },
        data: {
          '2026-09-01': { steps: [{ count: 200, event: 'Document Sent', step_conv_ratio: 1, overall_conv_ratio: 1 }, { count: 150, event: 'Link Opened' }, { count: 60, event: 'Document Signed' }], analysis: {} },
          '2026-09-15': { steps: [{ count: 0, event: 'Document Sent' }, { count: 0, event: 'Link Opened' }, { count: 0, event: 'Document Signed' }], analysis: {} },
        },
      });
    });
    const p = await mixpanelAnalyticsProvider('org_nw', source(), { fetch });

    const funnel = await p.funnel({ savedFunnelId: '7001', from: '2026-09-01', to: '2026-09-30', windowDays: 7 });

    expect(funnel).toEqual({
      name: 'Send to sign',
      from: '2026-09-01',
      to: '2026-09-30',
      steps: [
        { event: 'Document Sent', count: 200, fromPrevious: null, fromStart: 1 },
        { event: 'Link Opened', count: 150, fromPrevious: 0.75, fromStart: 0.75 },
        { event: 'Document Signed', count: 60, fromPrevious: 0.4, fromStart: 0.3 },
      ],
    });

    const query = calls.find(c => c.url.pathname === '/api/query/funnels')!.url.searchParams;

    expect(Object.fromEntries(query)).toMatchObject({ funnel_id: '7001', length: '7', length_unit: 'day', interval: '30' });
  });

  it('answers steps with a sentence naming the saved funnels, since its API builds none', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { fetch } = recorder(() => json([{ funnel_id: 7001, name: 'Send to sign' }]));
    const p = await mixpanelAnalyticsProvider('org_nw', source(), { fetch });

    await expect(p.funnel({ steps: ['Document Sent', 'Document Signed'], from: '2026-09-01', to: '2026-09-30', windowDays: 7 }))
      .rejects
      .toThrow(/reads saved funnels only.*Send to sign \(7001\)/);
    await expect(p.savedFunnels()).resolves.toEqual([{ id: '7001', name: 'Send to sign' }]);
  });

  it('lists cohorts with their size, by POST', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    const { calls, fetch } = recorder(() => json([{ id: 31001, name: 'Acme admins', description: 'Admins at Acme accounts', count: 42, created: '2026-08-01 10:00:00', project_id: 2000001, is_visible: 1 }]));
    const p = await mixpanelAnalyticsProvider('org_nw', source(), { fetch });

    await expect(p.cohorts()).resolves.toEqual([{ id: '31001', name: 'Acme admins', description: 'Admins at Acme accounts', size: 42, updated: '2026-08-01 10:00:00' }]);
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('waits out one 429 that says how long, then says the quota is spent', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    let n = 0;
    const { fetch } = recorder(() => (n++ === 0 ? json({ error: 'rate limited' }, 429, { 'retry-after': '2' }) : json(['Document Sent'])));
    const sleep = vi.fn(async () => {});
    const p = await mixpanelAnalyticsProvider('org_nw', source(), { fetch, sleep });

    await expect(p.listEvents(5)).resolves.toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(2000);

    const always = recorder(() => json({ error: 'rate limited' }, 429, { 'retry-after': '2' }));
    const p2 = await mixpanelAnalyticsProvider('org_nw', source(), { fetch: always.fetch, sleep });

    await expect(p2.listEvents(5)).rejects.toThrow(/rate limit.*60 queries an hour/);
    expect(always.calls).toHaveLength(2);
  });

  it('refuses a source with no credential, naming where to put one', async () => {
    creds.byOrg.org_empty = null;

    await expect(mixpanelAnalyticsProvider('org_empty', source())).rejects.toThrow(/no Mixpanel credential/);
  });

  it('spends each workspace\'s own service account, in sequence', async () => {
    creds.byOrg.org_nw = NORTHWIND;
    creds.byOrg.org_kc = KESTREL;
    const { calls, fetch } = recorder(() => json(['Document Sent']));

    await (await mixpanelAnalyticsProvider('org_nw', source(), { fetch })).listEvents(1);
    await (await mixpanelAnalyticsProvider('org_kc', source({ projectId: '2000002', region: 'us' }), { fetch })).listEvents(1);

    expect(basicUser(calls[0]!.init)).toBe(NORTHWIND.username);
    expect(basicUser(calls[1]!.init)).toBe(KESTREL.username);
    expect(calls[1]!.url.searchParams.get('project_id')).toBe('2000002');
  });
});

describe('mixpanel Test connection', () => {
  it('says which project and region answered', async () => {
    const { fetch } = recorder(() => json(['Document Sent', 'Link Opened']));
    const result = await inspectMixpanel({ config: { projectId: 2000001, region: 'in' }, credentials: NORTHWIND }, fetch);

    expect(result.authorized).toBe(true);
    expect(result.checks[0]!.label).toBe('Reads project 2000001 (https://in.mixpanel.com)');
    expect(result.checks[0]!.detail).toContain('Document Sent');
  });

  it('reports a refused service account as a sentence that names no secret', async () => {
    const { fetch } = recorder(() => json({ error: 'Invalid credentials' }, 401));
    const result = await inspectMixpanel({ config: { projectId: '2000001' }, credentials: NORTHWIND }, fetch);

    expect(result.authorized).toBe(false);
    expect(result.error).toMatch(/refused the service account/);
    expect(JSON.stringify(result)).not.toContain(NORTHWIND.secret);
  });

  it('refuses input it cannot test with', async () => {
    await expect(inspectMixpanel({ config: { projectId: '2000001' }, credentials: { username: 'x' } })).rejects.toThrow(/username and its secret/);
    await expect(inspectMixpanel({ config: {}, credentials: NORTHWIND })).rejects.toThrow(/project id/);
  });
});
