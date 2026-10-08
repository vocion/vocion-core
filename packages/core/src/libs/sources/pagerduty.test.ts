/**
 * PagerDuty, read live: Test connection lists what the key sees and reads one
 * incident; the incident provider lists by status and service, reads an
 * incident with its timeline and notes, and acknowledges as the user the
 * credential names — or says why it cannot. Recorded answers; invented
 * services.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pagerdutyIncidentProvider } from '@/services/incident/providers/pagerduty';
import { pagerdutyConnector } from './pagerduty';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function vendor(route: (url: string, method: string) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, headers: init.headers as Record<string, string>, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(route(url, method)), { status: 200 });
  }));
  return calls;
}

const SOURCE = { id: 6, slug: 'pagerduty', kind: 'pagerduty', config: { region: 'eu' }, apiTokenId: null };
const INCIDENT = { id: 'PT4KHLK', incident_number: 812, title: 'Checkout 5xx above 2%', status: 'triggered', urgency: 'high', html_url: 'https://acme.pagerduty.example/incidents/PT4KHLK', service: { summary: 'Checkout API' }, assignments: [{ assignee: { summary: 'Jamie Smith' } }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagerduty', () => {
  it('Test connection lists the services, reads one incident, and says whether it can acknowledge', async () => {
    const calls = vendor(url => (url.includes('/services') ? { services: [{ id: 'PSV1', name: 'Checkout API' }] } : { incidents: [INCIDENT] }));

    const out = await pagerdutyConnector.inspect!({ config: { region: 'eu', services: ['PSV1', 'PSV9'] }, credentials: { token: 'pd_tok' }, options: {} }) as { checks: Array<{ key: string; ok: boolean; detail: string }> };

    expect(calls[0]!.url).toBe('https://api.eu.pagerduty.com/services?limit=100');
    expect(calls[0]!.headers.authorization).toBe('Token token=pd_tok');
    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['services', true], ['service:PSV1', true], ['service:PSV9', false], ['incidents', true], ['acknowledge', true]]);
    expect(out.checks.at(-1)!.detail).toMatch(/No user email stored/);
    await expect(pagerdutyConnector.inspect!({ config: {}, credentials: {}, options: {} })).rejects.toThrow(/No PagerDuty API key/);
  });

  it('lists incidents by status and service, newest first', async () => {
    const calls = vendor(() => ({ incidents: [INCIDENT] }));
    const provider = pagerdutyIncidentProvider(SOURCE, { token: 'pd_tok' });

    await expect(provider.listIncidents({ statuses: ['triggered', 'acknowledged'], service: 'PSV1', limit: 10 })).resolves.toEqual([{ id: 'PT4KHLK', number: 812, title: 'Checkout 5xx above 2%', status: 'triggered', urgency: 'high', service: 'Checkout API', assignees: ['Jamie Smith'], created: null, url: INCIDENT.html_url }]);

    const params = new URL(calls[0]!.url).searchParams;

    expect(params.getAll('statuses[]')).toEqual(['triggered', 'acknowledged']);
    expect(params.getAll('service_ids[]')).toEqual(['PSV1']);
    expect(params.get('sort_by')).toBe('created_at:desc');
  });

  it('reads an incident with its timeline and notes', async () => {
    vendor((url) => {
      if (url.includes('/log_entries')) {
        return { log_entries: [{ created_at: 't1', type: 'trigger_log_entry', summary: 'Triggered through the API' }] };
      }
      if (url.includes('/notes')) {
        return { notes: [{ created_at: 't2', user: { summary: 'Jamie Smith' }, content: 'Rolling back 2.4.1' }] };
      }
      if (url.includes('/alerts')) {
        return { total: 3 };
      }
      return { incident: INCIDENT };
    });

    const incident = await pagerdutyIncidentProvider(SOURCE, { token: 'pd_tok' }).readIncident('PT4KHLK');

    expect(incident).toMatchObject({ alertCount: 3, timeline: [{ at: 't1', type: 'trigger', summary: 'Triggered through the API' }], notes: [{ author: 'Jamie Smith', body: 'Rolling back 2.4.1' }] });
  });

  it('acknowledges as the named user, leaves an incident already acknowledged alone, and refuses with no user named', async () => {
    let status = 'triggered';
    const calls = vendor((_url, method) => (method === 'PUT' ? { incident: { ...INCIDENT, status: 'acknowledged' } } : { incident: { ...INCIDENT, status } }));
    const provider = pagerdutyIncidentProvider(SOURCE, { token: 'pd_tok', fromEmail: 'oncall@acme.example' });

    await expect(provider.acknowledge('PT4KHLK')).resolves.toEqual({ from: 'triggered', to: 'acknowledged', url: INCIDENT.html_url });

    const put = calls.find(c => c.method === 'PUT')!;

    expect(put.headers.from).toBe('oncall@acme.example');
    expect(put.body).toEqual({ incident: { type: 'incident_reference', status: 'acknowledged' } });

    status = 'acknowledged';
    calls.length = 0;

    await expect(provider.acknowledge('PT4KHLK')).resolves.toMatchObject({ from: 'acknowledged', to: 'acknowledged' });
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
    await expect(pagerdutyIncidentProvider(SOURCE, { token: 'pd_tok' }).acknowledge('PT4KHLK')).rejects.toThrow(/names none/);
  });
});
