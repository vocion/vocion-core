import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripeConnector } from './stripe';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStripe(answer: (path: string) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const { status, body } = answer(new URL(url).pathname);
    return new Response(JSON.stringify(body), { status });
  }));
}

describe('the Stripe connector', () => {
  it('is read live, so it syncs nothing', async () => {
    const docs = [];
    for await (const doc of stripeConnector.sync({ sourceId: 1, orgId: 'o', config: {} })) {
      docs.push(doc);
    }

    expect(stripeConnector.syncless).toBe(true);
    expect(docs).toEqual([]);
  });

  it('Test connection says which records the key reads and which it was not granted', async () => {
    stubStripe(path => (path === '/v1/payouts'
      ? { status: 403, body: { error: { message: 'The provided key does not have the required permissions for this endpoint' } } }
      : { status: 200, body: { data: [], has_more: false } }));
    const out = await stripeConnector.inspect!({ config: {}, credentials: { apiKey: 'rk_live_FixtureNorthwind0001' }, options: {} }) as { authorized: boolean; checks: Array<{ key: string; ok: boolean }>; error: string | null; note: string | null };

    expect(out.authorized).toBe(true);
    expect(out.checks.map(c => `${c.key}:${c.ok}`)).toEqual(['customer:true', 'invoice:true', 'subscription:true', 'payment:true', 'payout:false']);
    expect(out.error).toBe('Stripe reads customer, invoice, subscription, payment; not payout.');
    expect(out.note).toBeNull();
  });

  it('stops at a refused key, and warns about a secret key that reads more than it needs', async () => {
    stubStripe(() => ({ status: 401, body: { error: { message: 'Invalid API Key provided' } } }));
    const out = await stripeConnector.inspect!({ config: {}, credentials: { apiKey: 'sk_live_FixtureNorthwind0001' }, options: {} }) as { authorized: boolean; checks: unknown[]; error: string; note: string };

    expect(out.authorized).toBe(false);
    expect(out.checks).toHaveLength(1);
    expect(out.error).toMatch(/Stripe refused the credential \(401\)/);
    expect(out.note).toMatch(/secret key/);
  });

  it('refuses to test without a key, as input the person fixes', async () => {
    await expect(stripeConnector.inspect!({ config: {}, credentials: {}, options: {} })).rejects.toThrow(/No Stripe key is stored/);
  });
});
