/**
 * The unenroll workflow bridge against a scripted HubSpot client: bridge
 * provisioning is idempotent, an unenroll waits for the portal to confirm and
 * clears its trigger, and a timeout names the workflow instead of guessing.
 */
import type { HubspotClient, HubspotResult } from './client';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureUnenrollBridge,
  readSequenceEnrollmentState,
  requestUnenroll,
  UNENROLL_FLOW_NAME,
  UNENROLL_REQUEST_PROPERTY,
} from './unenrollBridge';

const ok = <T>(data: T): HubspotResult<T> => ({ ok: true, data });
const notFound: HubspotResult<never> = { ok: false, error: 'hubspot_error', status: 404, message: 'HubSpot API error 404' };

type Call = { method: string; path: string; body?: unknown };

/**
 * A client whose GET/POST/PATCH consult a handler and record every call.
 * @param handler
 */
function scriptedClient(handler: (call: Call) => HubspotResult<unknown>): { client: HubspotClient; calls: Call[] } {
  const calls: Call[] = [];
  const run = (method: string) => async (path: string, bodyOrParams?: unknown) => {
    const call = { method, path, body: bodyOrParams };
    calls.push(call);
    return handler(call) as never;
  };
  return {
    calls,
    client: {
      baseUrl: 'https://api.hubapi.com',
      get: run('GET') as HubspotClient['get'],
      post: run('POST') as HubspotClient['post'],
      patch: run('PATCH') as HubspotClient['patch'],
      fetchDealStages: vi.fn(),
    },
  };
}

describe('readSequenceEnrollmentState', () => {
  it('reads the portal-wide flag off the contact', async () => {
    const { client } = scriptedClient(() => ok({ properties: { hs_sequences_is_enrolled: 'true', hs_latest_sequence_enrolled: '307' } }));
    const state = await readSequenceEnrollmentState(client, '42');

    expect(state).toEqual({ ok: true, data: { enrolled: true, latestSequenceId: '307' } });
  });
});

describe('ensureUnenrollBridge', () => {
  it('creates the property and the workflow when neither exists', async () => {
    const { client, calls } = scriptedClient((call) => {
      if (call.method === 'GET' && call.path.includes('/properties/')) {
        return notFound;
      }
      if (call.method === 'GET' && call.path === '/automation/v4/flows') {
        return ok({ results: [] });
      }
      return ok({ id: 999, name: UNENROLL_FLOW_NAME });
    });
    const bridge = await ensureUnenrollBridge(client);

    expect(bridge).toEqual({ ok: true, data: { flowId: '999', created: true } });

    const propertyCreate = calls.find(c => c.method === 'POST' && c.path === '/crm/v3/properties/contacts');
    const flowCreate = calls.find(c => c.method === 'POST' && c.path === '/automation/v4/flows');

    expect((propertyCreate?.body as { name: string }).name).toBe(UNENROLL_REQUEST_PROPERTY);
    expect((flowCreate?.body as { actions: Array<{ actionTypeId: string }> }).actions[0]!.actionTypeId).toBe('0-4702372');
    expect((flowCreate?.body as { isEnabled: boolean }).isEnabled).toBe(true);
  });

  it('creates nothing when both already exist, whichever flows page holds the workflow', async () => {
    const { client, calls } = scriptedClient((call) => {
      if (call.method === 'GET' && call.path.includes('/properties/')) {
        return ok({ name: UNENROLL_REQUEST_PROPERTY });
      }
      // Two pages: the bridge is on the second.
      const after = (call.body as Record<string, string> | undefined)?.after;
      return after
        ? ok({ results: [{ id: '55', name: UNENROLL_FLOW_NAME }] })
        : ok({ results: [{ id: '1', name: 'Something else' }], paging: { next: { after: 'p2' } } });
    });
    const bridge = await ensureUnenrollBridge(client);

    expect(bridge).toEqual({ ok: true, data: { flowId: '55', created: false } });
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
});

describe('requestUnenroll', () => {
  const bridgeExists = (call: Call): HubspotResult<unknown> | null => {
    if (call.method === 'GET' && call.path.includes('/properties/')) {
      return ok({ name: UNENROLL_REQUEST_PROPERTY });
    }
    if (call.method === 'GET' && call.path === '/automation/v4/flows') {
      return ok({ results: [{ id: '55', name: UNENROLL_FLOW_NAME }] });
    }
    return null;
  };

  it('stamps the trigger, waits for the portal to confirm, then clears the trigger', async () => {
    let polls = 0;
    const { client, calls } = scriptedClient((call) => {
      const bridged = bridgeExists(call);
      if (bridged) {
        return bridged;
      }
      if (call.method === 'GET' && call.path.includes('/objects/contacts/42')) {
        // Still enrolled on the first poll, gone on the second.
        polls += 1;
        return ok({ properties: { hs_sequences_is_enrolled: polls < 2 ? 'true' : 'false' } });
      }
      return ok({});
    });
    const result = await requestUnenroll(client, { contactId: '42', pollMs: 1, sleep: async () => {} });

    expect(result.ok).toBe(true);

    const patches = calls.filter(c => c.method === 'PATCH');

    expect(patches).toHaveLength(2);
    expect((patches[0]!.body as { properties: Record<string, string> }).properties[UNENROLL_REQUEST_PROPERTY]).toMatch(/^\d+$/);
    expect((patches[1]!.body as { properties: Record<string, string> }).properties[UNENROLL_REQUEST_PROPERTY]).toBe('');
  });

  it('times out naming the bridge workflow when the contact never unenrolls', async () => {
    const { client } = scriptedClient((call) => {
      const bridged = bridgeExists(call);
      if (bridged) {
        return bridged;
      }
      if (call.method === 'GET') {
        return ok({ properties: { hs_sequences_is_enrolled: 'true' } });
      }
      return ok({});
    });
    const result = await requestUnenroll(client, { contactId: '42', timeoutMs: 5, pollMs: 1, sleep: async () => {} });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(UNENROLL_FLOW_NAME);
  });
});
