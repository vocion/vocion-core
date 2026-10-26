import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGoogleAdsAccounts, mergeAccountChoices } from './client';

/**
 * The Connectors picker's list: what a Google login can run. Every id and
 * name is fictional.
 */

type Reply = { status?: number; body: unknown };

function stubGoogle(routes: Record<string, (body: { query?: string }, headers: Record<string, string>) => Reply>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    const key = Object.keys(routes).find(k => url.endsWith(k));
    const reply = key ? routes[key]!(init?.body ? JSON.parse(init.body) : {}, init?.headers ?? {}) : { status: 404, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listGoogleAdsAccounts', () => {
  it('lists the accounts reached directly and each manager\'s own clients, never the managers, A–Z', async () => {
    stubGoogle({
      'customers:listAccessibleCustomers': () => ({ body: { resourceNames: ['customers/1110000001', 'customers/2220000002', 'customers/3330000003'] } }),
      '1110000001/googleAds:search': () => ({ body: { results: [{ customer: { id: '1110000001', descriptiveName: 'Northwind Outdoors', manager: false } }] } }),
      '2220000002/googleAds:search': (body, headers) => body.query?.includes('customer_client')
        ? ({ body: { results: [
            { customerClient: { id: '4440000004', descriptiveName: 'Kestrel Video', manager: false } },
            { customerClient: { id: '5550000005', descriptiveName: 'Sub-manager', manager: true } },
          ] }, ...(headers['login-customer-id'] === '2220000002' ? {} : { status: 403 }) })
        : ({ body: { results: [{ customer: { id: '2220000002', descriptiveName: 'Harbor Agency', manager: true } }] } }),
      // Still being set up: Google refuses it, and it is skipped.
      '3330000003/googleAds:search': () => ({ status: 403, body: { error: { message: 'not enabled', details: [{ errors: [{ errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' } }] }] } } }),
    });

    expect(await listGoogleAdsAccounts('token')).toEqual([
      { customerId: '4440000004', name: 'Kestrel Video', managerId: '2220000002' },
      { customerId: '1110000001', name: 'Northwind Outdoors', managerId: null },
    ]);
  });

  it('says what Google said when the login itself is refused', async () => {
    stubGoogle({ 'customers:listAccessibleCustomers': () => ({ status: 401, body: { error: { message: 'Request had invalid authentication credentials.' } } }) });

    await expect(listGoogleAdsAccounts('stale')).rejects.toThrow();
  });
});

describe('mergeAccountChoices', () => {
  it('keeps an account reached directly once, without a manager', () => {
    expect(mergeAccountChoices(
      [{ customerId: '1', name: 'B', managerId: null }],
      [{ customerId: '1', name: 'B', managerId: '9' }, { customerId: '2', name: 'A', managerId: '9' }],
    )).toEqual([{ customerId: '2', name: 'A', managerId: '9' }, { customerId: '1', name: 'B', managerId: null }]);
  });
});
