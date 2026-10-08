import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { getPlatform, platformForConnectorSlug, validatePlatformCredential } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { inspectVonage, syncVonage, vonageConnector } from '@/libs/sources/vonage';
import { sendVonageSms } from '@/libs/vonage/client';

/** Vonage against a stand-in: the Reports API's call records, the balance, a text. Fictional values. */

const CREDS = { apiKey: 'a1b2c3d4', apiSecret: 'fixtureSecret0001', signatureSecret: 'fixture-signature', signatureMethod: 'sha256' };

function net(handler: (url: URL, init?: RequestInit) => { status?: number; json?: unknown }) {
  const seen: { url: URL; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    seen.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe('the vonage connector', () => {
  it('is registered on the vonage platform: key, secret, and the optional signature secret and method', () => {
    expect(getConnector('vonage')).toBe(vonageConnector);
    expect(platformForConnectorSlug('vonage')?.id).toBe('vonage');
    expect(getPlatform('vonage').fields.map(f => [f.name, f.secret, f.optional ?? false])).toEqual([['apiKey', false, false], ['apiSecret', true, false], ['signatureSecret', true, true], ['signatureMethod', false, true]]);
    expect(() => validatePlatformCredential('vonage', { ...CREDS, signatureMethod: 'sha3' })).toThrow(/Signature method/);
  });

  it('syncs both directions of voice calls from the Reports API, following its pages, with basic auth', async () => {
    const { fetchImpl, seen } = net((url) => {
      if (url.searchParams.get('direction') === 'inbound' && !url.searchParams.get('cursor')) {
        return { json: { records: [{ uuid: 'call-in-1', from: '19705550100', to: '19705550199', status: 'completed', start_time: '2026-10-06T15:00:00Z', end_time: '2026-10-06T15:02:00Z', duration: '120', total_price: '0.0120' }], _links: { next: { href: `${url.href}&cursor=2` } } } };
      }
      if (url.searchParams.get('cursor') === '2') {
        return { json: { records: [{ uuid: 'call-in-2', from: '19705550101', to: '19705550199', status: 'busy', start_time: '2026-10-05T10:00:00Z', duration: '0' }] } };
      }
      return { json: { records: [] } };
    });
    const docs = [];
    for await (const doc of syncVonage({ sourceId: 2, orgId: 'org_a', config: {}, credentials: CREDS }, fetchImpl)) {
      docs.push(doc);
    }

    expect(docs.map(d => d.externalId)).toEqual(['vonage:call:call-in-1', 'vonage:call:call-in-2']);
    expect(docs[0]!.content).toMatch(/from \+19705550100 to \+19705550199/);
    expect(docs[0]!.content).toMatch(/120 seconds; status completed; cost 0.0120/);
    expect(seen.map(s => s.url.searchParams.get('direction'))).toEqual(['inbound', 'inbound', 'outbound']);
    expect(new Headers(seen[0]!.init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('a1b2c3d4:fixtureSecret0001').toString('base64')}`);
  });

  it('tests the connection: the balance, the week of calls, and whether texts can be checked', async () => {
    const { fetchImpl } = net(url => (url.pathname.endsWith('get-balance') ? { json: { value: 12.5, autoReload: false } } : { json: { records: [] } }));
    const res = await inspectVonage({ credentials: CREDS }, fetchImpl);

    expect(res).toMatchObject({ authorized: true, error: null });
    expect(res.checks.map(c => [c.key, c.ok, c.detail])).toEqual([['account', true, 'Balance 12.50'], ['calls', true, '0 calls in the last 7 days'], ['signature', true, 'Signed webhooks, sha256']]);
  });

  it('says a refused key in words', async () => {
    const { fetchImpl } = net(() => ({ status: 401, json: { 'error-code': '401', 'error-code-label': 'authentication failed' } }));
    const res = await inspectVonage({ credentials: CREDS }, fetchImpl);

    expect(res).toMatchObject({ authorized: false, error: expect.stringMatching(/refused the API key and secret/) });
  });

  it('sends a text without the + Vonage does not write, and says a refusal Vonage puts in the body', async () => {
    const ok = net(() => ({ json: { messages: [{ 'status': '0', 'message-id': 'MSG1' }] } }));

    await expect(sendVonageSms({ ...CREDS, signatureMethod: 'sha256' }, { from: '+19705550199', to: '+19705550100', text: 'Done.' }, ok.fetchImpl)).resolves.toEqual({ id: 'MSG1' });
    expect(new URLSearchParams(String(ok.seen[0]!.init?.body)).get('to')).toBe('19705550100');

    const refused = net(() => ({ json: { messages: [{ 'status': '9', 'error-text': 'Quota Exceeded - rejected' }] } }));

    await expect(sendVonageSms({ ...CREDS, signatureMethod: 'sha256' }, { from: '+19705550199', to: '+19705550100', text: 'Done.' }, refused.fetchImpl)).rejects.toThrow(/Quota Exceeded/);
  });
});

describe('which Vonage account a call spends', () => {
  it('uses each workspace\'s own stored credential, one after the other', async () => {
    vi.resetModules();
    const stored: Record<string, Record<string, string>> = { org_a: { apiKey: 'aaaa1111', apiSecret: 'secretA0001' }, org_b: { apiKey: 'bbbb2222', apiSecret: 'secretB0002' } };
    vi.doMock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: async (orgId: string, platform: string) => (platform === 'vonage' ? stored[orgId] ?? null : null) }));
    const { vonageCredentialsFor } = await import('@/libs/vonage/client');

    expect((await vonageCredentialsFor('org_a'))?.apiKey).toBe('aaaa1111');
    expect((await vonageCredentialsFor('org_b'))?.apiKey).toBe('bbbb2222');
    expect(await vonageCredentialsFor('org_none')).toBeNull();

    vi.doUnmock('@/services/ApiTokenService');
  });
});
