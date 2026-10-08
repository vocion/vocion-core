/**
 * The Microsoft 365 sources on a "Log in with Microsoft" login: each
 * workspace spends its own login, an expiring one is refreshed before a sync
 * and Microsoft's rotated refresh token is saved to the row it was read from.
 * Database-backed like `hubspot.login.test.ts`; Microsoft is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { AUTH_MICROSOFT_ENTRA_ID_ID: 'entra_client', AUTH_MICROSOFT_ENTRA_ID_SECRET: 'entra_value' };
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { outlookMailConnector } = await import('./outlookMail');
const { graphTokenForConnector } = await import('@/services/agents/tools/microsoft365');

const EXPIRED = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const TOKEN_URL = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token';

let orgCounter = 0;

/**
 * An Outlook mail source on a stored Microsoft login, in its own workspace.
 * @param grant - The values the login row holds.
 */
async function seedSourceOnLogin(grant: Record<string, unknown>) {
  orgCounter += 1;
  const orgId = `org_m365_login_${orgCounter}`;
  const stored = await storeLoginCredential({ orgId, platform: 'microsoft', name: 'Microsoft - Contoso', account: `ann${orgCounter}@contoso.example`, values: grant, createdBy: 'user_admin' });
  const [source] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug: 'outlook-mail',
    kind: 'plugin',
    configJson: { _connector: 'outlook-mail' },
    apiTokenId: stored.id,
    apiTokenExclusive: false,
  }).returning({ id: knowledgeSourceSchema.id });
  return { orgId, tokenId: stored.id, sourceId: source!.id };
}

/**
 * Stub `fetch`: the token endpoint hands out `at-new`/`rt-new`; Graph answers
 * one message. Records each call's URL and bearer.
 */
function stubMicrosoft() {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: headers.authorization ?? null });
    const body = String(url) === TOKEN_URL
      ? { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600, scope: 'Mail.Read User.Read' }
      : { value: [{ id: 'AAMkAD-1', conversationId: 'conv-1', subject: 'Northwind renewal', bodyPreview: 'Can we move the call?', from: { emailAddress: { name: 'Mara Ruiz', address: 'mara@northwind.example' } }, receivedDateTime: '2026-10-07T15:00:00Z' }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

/**
 * Drain a sync of the Outlook mail source.
 * @param context - Sync context fields.
 * @param context.orgId - The workspace.
 * @param context.sourceId - The source row.
 * @param context.credentials - The bag the sync loaded.
 */
async function runSync(context: { orgId: string; sourceId: number; credentials: Record<string, unknown> }) {
  const docs = [];
  for await (const doc of outlookMailConnector.sync({ ...context, config: {} })) {
    docs.push(doc);
  }
  return docs;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Microsoft 365 sources on a login', () => {
  it('each workspace reads with its own login, never the other\'s', async () => {
    const first = await seedSourceOnLogin({ accessToken: 'at-org-one', refreshToken: 'rt-one', expiresAt: FAR_FUTURE, scope: 'Mail.Read' });
    const second = await seedSourceOnLogin({ accessToken: 'at-org-two', refreshToken: 'rt-two', expiresAt: FAR_FUTURE, scope: 'Mail.Read' });
    const calls = stubMicrosoft();

    const firstCredentials = await getCredentialsForConnector({ orgId: first.orgId, connectorSlug: 'outlook-mail', apiTokenId: first.tokenId });
    await runSync({ orgId: first.orgId, sourceId: first.sourceId, credentials: firstCredentials! });
    const secondCredentials = await getCredentialsForConnector({ orgId: second.orgId, connectorSlug: 'outlook-mail', apiTokenId: second.tokenId });
    await runSync({ orgId: second.orgId, sourceId: second.sourceId, credentials: secondCredentials! });

    expect(calls.map(call => call.authorization)).toEqual(['Bearer at-org-one', 'Bearer at-org-two']);

    // The agent tools and actions resolve the same way, per org, in sequence.
    expect(await graphTokenForConnector(second.orgId, ['outlook-mail'])).toEqual({ ok: true, token: 'at-org-two' });
    expect(await graphTokenForConnector(first.orgId, ['outlook-mail'])).toEqual({ ok: true, token: 'at-org-one' });
  });

  it('syncs a message as a document a search can match, keyed so the thread tool can find its conversation', async () => {
    const { orgId, sourceId } = await seedSourceOnLogin({ accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE });
    const calls = stubMicrosoft();

    const docs = await runSync({ orgId, sourceId, credentials: { accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE } });

    expect(docs).toEqual([expect.objectContaining({
      externalId: 'outlook:AAMkAD-1',
      title: 'Northwind renewal',
      content: 'From: Mara Ruiz <mara@northwind.example>\nSubject: Northwind renewal\n\nCan we move the call?',
      metadata: expect.objectContaining({ kind: 'outlook-message', conversationId: 'conv-1' }),
    })]);

    const url = new URL(calls[0]!.url);

    expect(url.pathname).toBe('/v1.0/me/mailFolders/inbox/messages');
    expect(url.searchParams.get('$filter')).toMatch(/^receivedDateTime ge \d{4}-/);
  });

  it('an incremental sync asks only for mail received since the watermark', async () => {
    const { orgId, sourceId } = await seedSourceOnLogin({ accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE });
    const calls = stubMicrosoft();

    for await (const _doc of outlookMailConnector.sync({ orgId, sourceId, credentials: { accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: FAR_FUTURE }, config: {}, since: new Date('2026-10-01T00:00:00.000Z') })) {
      // The filter is what matters.
    }

    expect(new URL(calls[0]!.url).searchParams.get('$filter')).toBe('receivedDateTime ge 2026-10-01T00:00:00.000Z');
  });

  it('refreshes an expired login before reading, reads with the new token, and saves Microsoft\'s rotated refresh token', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED, account: 'ann@contoso.example', scope: 'Mail.Read' };
    const { orgId, tokenId, sourceId } = await seedSourceOnLogin(grant);
    const calls = stubMicrosoft();

    await runSync({ orgId, sourceId, credentials: grant });

    const graphCalls = calls.filter(call => call.url !== TOKEN_URL);

    expect(calls.filter(call => call.url === TOKEN_URL)).toHaveLength(1);
    expect(graphCalls.every(call => call.authorization === 'Bearer at-new')).toBe(true);
    expect(await getCredentialsForConnector({ orgId, connectorSlug: 'outlook-mail', apiTokenId: tokenId }))
      .toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new', account: 'ann@contoso.example', scope: 'Mail.Read User.Read' });
  });

  it('a refused refresh fails the sync with a sentence that says to log in with Microsoft again', async () => {
    const grant = { accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: EXPIRED };
    const { orgId, sourceId } = await seedSourceOnLogin(grant);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    await expect(runSync({ orgId, sourceId, credentials: grant })).rejects.toThrow(/log in with Microsoft again/);
  });

  it('with no login at all it says what to connect', async () => {
    await expect(runSync({ orgId: 'org_m365_none', sourceId: 1, credentials: {} })).rejects.toThrow(/log in with Microsoft on the Connectors page/);
  });
});
