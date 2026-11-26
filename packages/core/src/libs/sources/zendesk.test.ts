/**
 * The Zendesk connector's Test connection: what it proves about an OAuth
 * client before anyone relies on it, against a fake Zendesk.
 */
import { describe, expect, it } from 'vitest';
import { depsFor, FakeZendesk, tokenAnswer } from '@/libs/zendesk/fakeZendesk';
import { InspectInputError } from './inspect';
import { getConnector } from './registry';
import { inspectZendesk, zendeskConnector } from './zendesk';

const TOKENS = '/oauth/tokens';
const ME = '/api/v2/users/me.json';

let clientCount = 0;

/**
 * Credential values as the form sends them, with a client ID no other test
 * has used, so the module's token cache starts empty for it.
 */
function typedCredentials(): Record<string, unknown> {
  clientCount += 1;
  return { subdomain: 'acme.zendesk.com', clientId: `vocion-inspect-${clientCount}`, clientSecret: 'fixture-secret-0001' };
}

/**
 * Zendesk's Show Self answer for a user with this role.
 * @param role - `admin`, `agent` or `end-user`.
 */
function me(role: string) {
  return { status: 200, body: { user: { id: 4242, role, name: 'Fixture Admin', email: 'admin@example.com' } } };
}

describe('the zendesk connector', () => {
  it('is registered, live and sync-less, so its row offers Test connection', async () => {
    expect(getConnector('zendesk')).toBe(zendeskConnector);
    expect(zendeskConnector.syncless).toBe(true);
    expect(zendeskConnector.authKind).toBe('apikey');
    expect(zendeskConnector.configSchema.parse({})).toEqual({});

    const docs = [];
    for await (const doc of zendeskConnector.sync({} as never)) {
      docs.push(doc);
    }

    expect(docs).toEqual([]);
  });
});

describe('inspectZendesk', () => {
  it('passes an admin\'s client and shows the role and user id, never a name or email', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [me('admin')] });

    const result = await inspectZendesk({ credentials: typedCredentials() }, depsFor(fake));

    expect(result).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(result.checks.map(check => [check.key, check.ok])).toEqual([['token', true], ['acts-as', true]]);
    expect(result.checks[0]!.detail).toBe('Granted: users:read.');
    expect(result.checks[1]!.detail).toMatch(/^User 4242, role admin\./);
    expect(JSON.stringify(result)).not.toMatch(/Fixture Admin|admin@example\.com/);
    // Test connection asks for the one scope it uses.
    expect(JSON.parse(fake.sentTo(TOKENS)[0]!.init.body as string).scope).toBe('users:read');
  });

  it('passes an agent\'s client too', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [me('agent')] });

    await expect(inspectZendesk({ credentials: typedCredentials() }, depsFor(fake))).resolves.toMatchObject({ authorized: true });
  });

  it('fails a client whose token acts as an end-user, who cannot work tickets', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [me('end-user')] });

    const result = await inspectZendesk({ credentials: typedCredentials() }, depsFor(fake));

    expect(result.authorized).toBe(false);
    expect(result.checks.find(check => check.key === 'acts-as')).toMatchObject({ ok: false, detail: expect.stringMatching(/role end-user.*agent or admin/) });
    expect(result.error).toMatch(/agent or admin/);
  });

  it('mints a new token on every test, so a cached one cannot vouch for a client that has since been revoked', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1'), tokenAnswer('tok-2')], [ME]: [me('admin')] });
    const credentials = typedCredentials();

    await inspectZendesk({ credentials }, depsFor(fake));
    await inspectZendesk({ credentials }, depsFor(fake));

    expect(fake.sentTo(TOKENS)).toHaveLength(2);
  });

  it('reports a refused client in Zendesk\'s words, as reachable but not authorized', async () => {
    // Zendesk does not document this body; the shape is assumed.
    const fake = new FakeZendesk({ [TOKENS]: [{ status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } }] });

    const result = await inspectZendesk({ credentials: typedCredentials() }, depsFor(fake));

    expect(result).toMatchObject({ reachable: true, authorized: false, note: null });
    expect(result.checks).toEqual([{ key: 'token', label: 'Gets an OAuth token from acme.zendesk.com', ok: false, detail: expect.stringMatching(/Client authentication failed/) }]);
    expect(result.error).toMatch(/Check the client ID and secret/);
    expect(fake.sentTo(ME)).toEqual([]);
  });

  it('says Zendesk was not reached when the network fails', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [new TypeError('fetch failed')] });

    await expect(inspectZendesk({ credentials: typedCredentials() }, depsFor(fake))).resolves.toMatchObject({ reachable: false, authorized: false });
  });

  it('says Zendesk was not reached when the users/me call times out after the token arrived', async () => {
    const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [timedOut] });

    const result = await inspectZendesk({ credentials: typedCredentials() }, depsFor(fake));

    expect(result).toMatchObject({ reachable: false, authorized: false, error: 'Zendesk could not be reached at acme.zendesk.com (TimeoutError).' });
  });

  it('still counts Zendesk as reached when users/me answered with an error status', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [ME]: [{ status: 403, body: { error: 'Forbidden' } }] });

    await expect(inspectZendesk({ credentials: typedCredentials() }, depsFor(fake))).resolves.toMatchObject({ reachable: true, authorized: false });
  });

  it('fails the token check when Zendesk issues a token without the scope asked for', async () => {
    // An unrecognised scope still gets a token, and every call made with it
    // answers 403; caught here rather than as a puzzling 403 later.
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1', { scope: 'tickets:read' })], [ME]: [me('admin')] });

    const result = await inspectZendesk({ credentials: typedCredentials() }, depsFor(fake));

    expect(result.authorized).toBe(false);
    expect(result.checks).toEqual([{ key: 'token', label: 'Gets an OAuth token from acme.zendesk.com', ok: false, detail: expect.stringMatching(/without users:read \(granted: tickets:read\)/) }]);
    expect(fake.sentTo(ME)).toEqual([]);
  });

  it('fails acts-as when the token is refused, pointing at the admin who made the client', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1'), tokenAnswer('tok-2'), tokenAnswer('tok-3')], [ME]: [{ status: 401, body: { error: 'invalid_token' } }] });

    const result = await inspectZendesk({ credentials: typedCredentials() }, depsFor(fake));

    expect(result.authorized).toBe(false);
    expect(result.checks.find(check => check.key === 'acts-as')).toMatchObject({ ok: false, detail: expect.stringMatching(/admin who made the OAuth client/) });
  });

  it('turns values it cannot use into a message for whoever is typing', async () => {
    const fake = new FakeZendesk({});

    await expect(inspectZendesk({ credentials: { subdomain: 'evil.com', clientId: 'c', clientSecret: 's' } }, depsFor(fake))).rejects.toBeInstanceOf(InspectInputError);
    await expect(inspectZendesk({ credentials: { subdomain: 'acme' } }, depsFor(fake))).rejects.toThrow(/client ID, client secret/);
    expect(fake.calls).toEqual([]);
  });
});
