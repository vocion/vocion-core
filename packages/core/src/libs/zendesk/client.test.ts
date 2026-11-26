/**
 * The Zendesk client: where the server sends the client secret, how long it
 * keeps a token, and when it asks for another. Every test talks to a fake
 * Zendesk; nothing here reaches the network.
 *
 * The token cache is module state, so each test uses its own client ID and
 * never sees another test's token.
 */
import type { ZendeskCredentials } from './client';
import { describe, expect, it, vi } from 'vitest';
import { getZendeskToken, normalizeZendeskSubdomain, zendeskCredentialsFrom, ZendeskError, zendeskRequest } from './client';
import { depsFor, FakeZendesk, tokenAnswer } from './fakeZendesk';

let clientCount = 0;

/**
 * A client no other test has used, so the module's token cache starts empty for it.
 * @param overrides - Values to change.
 */
function freshClient(overrides: Partial<ZendeskCredentials> = {}): ZendeskCredentials {
  clientCount += 1;
  return { subdomain: 'acme', clientId: `vocion-test-${clientCount}`, clientSecret: 'fixture-secret-0001', ...overrides };
}

const ME = '/api/v2/users/me.json';
const TOKENS = '/oauth/tokens';
const READ_ME = { path: ME, scopes: ['users:read'] } as const;
const MINUTE = 60_000;

/**
 * A 200 whose body breaks off part way, as when the timeout fires mid-read.
 */
function cutOffAnswer(): Response {
  return new Response(new ReadableStream({ start: controller => controller.error(new Error('connection reset')) }), { status: 200 });
}

/**
 * The bearer token a request carried.
 * @param init - The request.
 */
function bearerOf(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string>).authorization;
}

describe('normalizeZendeskSubdomain', () => {
  it('reads the account out of the shapes people paste', () => {
    for (const pasted of ['acme', ' ACME ', 'acme.zendesk.com', 'https://acme.zendesk.com/', 'http://acme.zendesk.com', 'acme.zendesk.com/']) {
      expect(normalizeZendeskSubdomain(pasted)).toBe('acme');
    }

    expect(normalizeZendeskSubdomain('acme-support2')).toBe('acme-support2');
  });

  it('refuses anything that could send the client secret to a host other than one zendesk.com account', () => {
    for (const pasted of [
      '',
      'evil.com',
      'a.b',
      'zendesk.com',
      'support.acme.com',
      'acme.zendesk.com.evil.com',
      'acme.zendesk.com:443@evil.com',
      'https://user@acme.zendesk.com',
      'https://acme.zendesk.com:8443',
      'https://acme.zendesk.com/agent/tickets',
      'https://acme.zendesk.com?next=evil.com',
      'acme\\evil.com',
      '-acme',
      42,
      null,
    ]) {
      expect(normalizeZendeskSubdomain(pasted), String(pasted)).toBeNull();
    }
  });
});

describe('zendeskCredentialsFrom', () => {
  it('names every value that is missing', () => {
    const parsed = zendeskCredentialsFrom({ subdomain: 'acme' });

    expect(parsed).toEqual({ ok: false, message: 'The Zendesk credential needs the account\'s client ID, client secret.' });
  });

  it('explains a subdomain it cannot use, including custom domains', () => {
    const parsed = zendeskCredentialsFrom({ subdomain: 'support.acme.com', clientId: 'vocion', clientSecret: 's' });

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toMatch(/before \.zendesk\.com.*Custom domains are not supported/);
  });

  it('keeps the normalized subdomain', () => {
    expect(zendeskCredentialsFrom({ subdomain: 'https://acme.zendesk.com/', clientId: ' vocion ', clientSecret: 's' }))
      .toEqual({ ok: true, credentials: { subdomain: 'acme', clientId: 'vocion', clientSecret: 's' } });
  });
});

describe('zendeskRequest tokens', () => {
  it('asks the account itself for a client credentials token, with only the scopes the call needs', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 200, body: { user: { id: 1 } } }] });
    const client = freshClient();

    await zendeskRequest(client, READ_ME, depsFor(fake));

    const [mint] = fake.sentTo(TOKENS);

    expect(mint!.url).toBe('https://acme.zendesk.com/oauth/tokens');
    expect(mint!.init.method).toBe('POST');
    expect(JSON.parse(mint!.init.body as string)).toEqual({
      grant_type: 'client_credentials',
      client_id: client.clientId,
      client_secret: 'fixture-secret-0001',
      scope: 'users:read',
      expires_in: 3600,
    });
    expect(bearerOf(fake.sentTo(ME)[0]!.init)).toBe('Bearer tok-1');
    // Nothing goes anywhere but the account, and a redirect is never
    // followed, so the secret in the token request cannot be re-sent elsewhere.
    expect(fake.calls.every(call => call.url.startsWith('https://acme.zendesk.com/'))).toBe(true);
    expect(fake.calls.every(call => call.init.redirect === 'error')).toBe(true);
  });

  it('reuses a token until five minutes before it expires, then mints a new one', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1'), tokenAnswer('tok-2')], [ME]: [{ status: 200, body: {} }] });
    const client = freshClient();
    const start = fake.now;

    await zendeskRequest(client, READ_ME, depsFor(fake));
    fake.now = start + 54 * MINUTE;
    await zendeskRequest(client, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(1);

    fake.now = start + 56 * MINUTE;
    await zendeskRequest(client, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(2);
    expect(bearerOf(fake.sentTo(ME)[2]!.init)).toBe('Bearer tok-2');
  });

  it('assumes Zendesk\'s 30-minute default when the answer leaves out expires_in, not an hour', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1', { expires_in: undefined })], [ME]: [{ status: 200, body: {} }] });
    const client = freshClient();
    const start = fake.now;

    await zendeskRequest(client, READ_ME, depsFor(fake));
    fake.now = start + 26 * MINUTE;
    await zendeskRequest(client, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(1);

    fake.now = start + 28 * MINUTE;
    await zendeskRequest(client, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(2);
  });

  it('keeps using a five-minute token for most of its life instead of minting on every call', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1', { expires_in: 300 })], [ME]: [{ status: 200, body: {} }] });
    const client = freshClient();

    await zendeskRequest(client, READ_ME, depsFor(fake));
    fake.now += 4 * MINUTE;
    await zendeskRequest(client, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(1);
  });

  it('mints a new token when the saved secret changes, instead of reusing the old secret\'s', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-old'), tokenAnswer('tok-new')], [ME]: [{ status: 200, body: {} }] });
    const client = freshClient();

    await zendeskRequest(client, READ_ME, depsFor(fake));
    await zendeskRequest({ ...client, clientSecret: 'fixture-secret-0002' }, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(2);
    expect(bearerOf(fake.sentTo(ME)[1]!.init)).toBe('Bearer tok-new');
  });

  it('keeps a separate token per scope set, so a write never borrows a read-only token', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-read'), tokenAnswer('tok-tickets', { scope: 'tickets:read' })], [ME]: [{ status: 200, body: {} }] });
    const client = freshClient();

    await zendeskRequest(client, READ_ME, depsFor(fake));
    await zendeskRequest(client, { path: ME, scopes: ['tickets:read'] }, depsFor(fake));

    expect(fake.sentTo(TOKENS).map(call => JSON.parse(call.init.body as string).scope)).toEqual(['users:read', 'tickets:read']);
  });

  it('keeps two accounts\' tokens apart when one server calls both in turn', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-acme'), tokenAnswer('tok-beta')], [ME]: [{ status: 200, body: { user: { id: 1 } } }] });
    // The same Identifier and secret on both, so only the account keeps the two
    // tokens apart: a cache keyed on the client alone would hand acme's token to beta.
    const acme = freshClient({ subdomain: 'acme' });
    const beta = { ...acme, subdomain: 'beta' };

    await zendeskRequest(acme, READ_ME, depsFor(fake));
    await zendeskRequest(beta, READ_ME, depsFor(fake));
    await zendeskRequest(acme, READ_ME, depsFor(fake));

    expect(fake.sentTo(TOKENS).map(call => new URL(call.url).host)).toEqual(['acme.zendesk.com', 'beta.zendesk.com']);
    expect(fake.sentTo(ME).map(call => [new URL(call.url).host, bearerOf(call.init)])).toEqual([
      ['acme.zendesk.com', 'Bearer tok-acme'],
      ['beta.zendesk.com', 'Bearer tok-beta'],
      ['acme.zendesk.com', 'Bearer tok-acme'],
    ]);
  });

  it('refuses to ask for a token with no scopes, before sending anything', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')] });

    await expect(getZendeskToken(freshClient(), [], depsFor(fake))).rejects.toMatchObject({ status: null, message: 'A Zendesk token needs at least one OAuth scope, and none was asked for.' });
    await expect(zendeskRequest(freshClient(), { path: ME, scopes: [] }, depsFor(fake))).rejects.toBeInstanceOf(ZendeskError);
    expect(fake.calls).toEqual([]);
  });

  it('shares one mint between calls that start together', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 200, body: {} }] });
    const client = freshClient();

    await Promise.all([zendeskRequest(client, READ_ME, depsFor(fake)), zendeskRequest(client, READ_ME, depsFor(fake))]);

    expect(fake.sentTo(TOKENS)).toHaveLength(1);
    expect(fake.sentTo(ME)).toHaveLength(2);
  });
});

describe('zendeskRequest when Zendesk refuses the token', () => {
  it('mints one fresh token after a 401 and sends the call once more', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1'), tokenAnswer('tok-2')],
      [ME]: [{ status: 401, body: { error: 'invalid_token' } }, { status: 200, body: { user: { id: 7 } } }],
    });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).resolves.toEqual({ user: { id: 7 } });
    expect(fake.sentTo(TOKENS)).toHaveLength(2);
    expect(fake.sentTo(ME).map(call => bearerOf(call.init))).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    // The refused answer is let go before the resend, not left holding its connection.
    expect(fake.responses.map(response => response.bodyUsed)).toEqual([true, true, true, true]);
  });

  it('stops after the second 401 instead of looping, and says whose access to check', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1'), tokenAnswer('tok-2')], [ME]: [{ status: 401, body: { error: 'invalid_token' } }] });

    const failure = await zendeskRequest(freshClient(), READ_ME, depsFor(fake)).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ZendeskError);
    expect(failure).toMatchObject({ status: 401, message: expect.stringMatching(/admin who made the OAuth client/) });
    expect(fake.sentTo(TOKENS)).toHaveLength(2);
    expect(fake.sentTo(ME)).toHaveLength(2);
  });

  it('does not mint again on a 403, which a new token would not fix', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 403, body: { error: 'Forbidden' } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/allows users:read/) });
    expect(fake.sentTo(TOKENS)).toHaveLength(1);
    expect(fake.sentTo(ME)).toHaveLength(1);
  });

  it('mints once, not once per caller, when calls in flight are refused together', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1'), tokenAnswer('tok-2'), tokenAnswer('tok-3')],
      [ME]: [{ status: 200, body: {} }, { status: 401 }, { status: 401 }, { status: 200, body: {} }],
    });
    const client = freshClient();
    await zendeskRequest(client, READ_ME, depsFor(fake));

    await Promise.all([zendeskRequest(client, READ_ME, depsFor(fake)), zendeskRequest(client, READ_ME, depsFor(fake))]);

    expect(fake.sentTo(TOKENS)).toHaveLength(2);
    expect(fake.sentTo(ME).slice(3).map(call => bearerOf(call.init))).toEqual(['Bearer tok-2', 'Bearer tok-2']);
  });
});

describe('zendeskRequest failures', () => {
  it('shows Zendesk\'s words for a refused client, with the secret blanked out', async () => {
    // Zendesk does not document this body; the shape is assumed from the
    // OAuth error it documents for an expired token.
    const fake = new FakeZendesk({ [TOKENS]: [{ status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed for fixture-secret-0001' } }] });

    const failure = await zendeskRequest(freshClient(), READ_ME, depsFor(fake)).catch((err: unknown) => err) as ZendeskError;

    expect(failure.status).toBe(401);
    expect(failure.message).toMatch(/refused the OAuth client for acme\.zendesk\.com: Client authentication failed for \[redacted\]/);
    expect(failure.message).not.toContain('fixture-secret-0001');
  });

  it('says which scopes to allow when the client is limited to others', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [{ status: 400, body: { error: 'invalid_scope' } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).rejects.toThrow(/would not grant the scopes this needs \(users:read\).*leave Scopes empty/);
  });

  it('never quotes the token back from an error body', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-echoed-0001')], [ME]: [{ status: 500, body: 'upstream failed for Bearer tok-echoed-0001' }] });

    const failure = await zendeskRequest(freshClient(), READ_ME, depsFor(fake)).catch((err: unknown) => err) as ZendeskError;

    expect(failure.message).toMatch(/HTTP 500/);
    expect(failure.message).not.toContain('tok-echoed-0001');
  });

  it('waits out a short Retry-After once and carries on', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 429, headers: { 'retry-after': '2' } }, { status: 200, body: { ok: true } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).resolves.toEqual({ ok: true });
    expect(fake.waits).toEqual([2000]);
    // The 429 is let go before the wait, not held open through it.
    expect(fake.responses.map(response => response.bodyUsed)).toEqual([true, true, true]);
  });

  it('reports a long rate-limit wait instead of holding the call open for it', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 429, headers: { 'retry-after': '120' } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/rate limit/) });
    expect(fake.waits).toEqual([]);
  });

  it('waits out a 429 only once, and reports the second instead of waiting again', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 429, headers: { 'retry-after': '2' } }, { status: 429, headers: { 'retry-after': '2' } }, { status: 200, body: { ok: true } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/rate limit/) });
    expect(fake.waits).toEqual([2000]);
    expect(fake.sentTo(ME)).toHaveLength(2);
  });

  it('waits a Retry-After of exactly 10 seconds, the longest it will hold a call', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 429, headers: { 'retry-after': '10' } }, { status: 200, body: { ok: true } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).resolves.toEqual({ ok: true });
    expect(fake.waits).toEqual([10_000]);
  });

  it('does not wait a Retry-After of 11 seconds', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 429, headers: { 'retry-after': '11' } }, { status: 200, body: { ok: true } }] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).rejects.toMatchObject({ status: 429 });
    expect(fake.waits).toEqual([]);
  });

  it('gives every attempt its own 15-second timeout, the token request included', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 429, headers: { 'retry-after': '1' } }, { status: 200, body: { ok: true } }] });

    try {
      await zendeskRequest(freshClient(), READ_ME, depsFor(fake));

      expect(timeout.mock.calls).toEqual([[15_000], [15_000], [15_000]]);
      expect(fake.calls.every((call, index) => call.init.signal === timeout.mock.results[index]!.value)).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  it('reports a success whose body is not a JSON object, instead of handing back nothing', async () => {
    for (const body of ['<html>Sign in to continue</html>', '[]', 'null', '  ']) {
      const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 200, body }] });

      await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake)), JSON.stringify(body)).rejects.toMatchObject({ status: 200, message: 'Zendesk answered GET /api/v2/users/me.json with HTTP 200 but no JSON object, so there was nothing to read.' });
    }
  });

  it('hands back an empty object for a success with no body, so a confirmed write is not reported as failed', async () => {
    for (const answer of [{ status: 204, body: null }, { status: 200, body: '' }, { status: 201, body: '' }]) {
      const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [answer] });

      await expect(zendeskRequest(freshClient(), { ...READ_ME, method: 'PUT', body: '{}' }, depsFor(fake)), String(answer.status)).resolves.toEqual({});
    }
  });

  it('reports a success whose body broke off, rather than calling it empty', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')] });
    const deps = { ...depsFor(fake), fetch: (url: string, init: RequestInit) => new URL(url).pathname === ME ? Promise.resolve(cutOffAnswer()) : fake.send(url, init) };

    await expect(zendeskRequest(freshClient(), READ_ME, deps)).rejects.toMatchObject({ status: 200, message: 'Zendesk answered GET /api/v2/users/me.json with HTTP 200, but the body could not be read to the end.' });
  });

  it('shows the sentence from an API error, not just its code', async () => {
    const answers = [
      { status: 422, body: { error: 'RecordInvalid', description: 'Record validation errors' }, said: 'Record validation errors' },
      { status: 403, body: { error: { title: 'Forbidden', message: 'You do not have access to this page.' } }, said: 'You do not have access to this page.' },
      { status: 400, body: { description: 'Ticket is closed', error: { title: 'Invalid', message: 'Update failed' } }, said: 'Ticket is closed' },
      { status: 409, body: { error: { title: 'Conflict', message: 'Ticket changed meanwhile' }, message: 'Conflict' }, said: 'Ticket changed meanwhile' },
      { status: 404, body: { error: 'RecordNotFound' }, said: 'RecordNotFound' },
    ];
    for (const { status, body, said } of answers) {
      const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status, body }] });

      await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake)), String(status)).rejects.toThrow(`: ${said}.`);
    }
  });

  it('says Zendesk could not be reached when the network fails, with no status', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [new TypeError('fetch failed')] });

    await expect(zendeskRequest(freshClient(), READ_ME, depsFor(fake))).rejects.toMatchObject({ status: null, message: 'Zendesk could not be reached at acme.zendesk.com (TypeError).' });
  });

  it('refuses a path outside the API before getting a token', async () => {
    const fake = new FakeZendesk({});

    await expect(zendeskRequest(freshClient(), { path: '/oauth/tokens', scopes: ['users:read'] }, depsFor(fake))).rejects.toThrow(/start with \/api\/v2\//);
    expect(fake.calls).toEqual([]);
  });

  it('refuses a path that climbs out of the API once resolved, before getting a token', async () => {
    const fake = new FakeZendesk({});

    for (const path of ['/api/v2/../../oauth/tokens/current', '/api/v2/%2e%2e/%2E%2E/oauth/tokens', '/api/v2/tickets/..\\..\\..\\oauth/tokens', '/api/v2/../v2x/users']) {
      await expect(zendeskRequest(freshClient(), { path, scopes: ['users:read'] }, depsFor(fake)), path).rejects.toThrow(/stay under it/);
    }

    expect(fake.calls).toEqual([]);
  });

  it('still sends a path that only steps around inside the API', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 200, body: { user: { id: 1 } } }] });

    await expect(zendeskRequest(freshClient(), { path: '/api/v2/tickets/../users/me.json', scopes: ['users:read'] }, depsFor(fake))).resolves.toEqual({ user: { id: 1 } });
    expect(fake.sentTo(ME)).toHaveLength(1);
  });
});
