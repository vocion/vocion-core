import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { MICROSOFT_IDENTITY_SCOPES, MICROSOFT_LOGIN_SCOPES, microsoftProvider, refreshMicrosoftGrant } = await import('./microsoft');
const { howToConnectFor, loginIsEnough, platformForConnectorSlug } = await import('@/libs/platforms/registry');
const { providerForConnector } = await import('../registry');

const CALLBACK = 'https://v.example/api/connect/microsoft/callback';
const CONNECTORS = ['outlook-mail', 'outlook-calendar', 'microsoft-teams', 'sharepoint', 'onedrive'];

/**
 * The Graph delegated permissions the founder registered on the Entra app
 * (2026-10-08). A login must never ask for one outside this list: Entra
 * refuses a scope the app does not list for a tenant whose users cannot
 * consent to unlisted permissions.
 */
const REGISTERED = new Set(['offline_access', 'User.Read', 'Mail.Read', 'Calendars.ReadWrite', 'Files.Read.All', 'Sites.Read.All', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send', 'Chat.Read']);

describe('microsoft connect provider', () => {
  beforeEach(() => {
    env.AUTH_MICROSOFT_ENTRA_ID_ID = 'entra_client';
    env.AUTH_MICROSOFT_ENTRA_ID_SECRET = 'entra_value';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs on the sign-in Entra app, and is configured only when both halves are set', () => {
    expect(microsoftProvider.requiredEnv).toEqual(['AUTH_MICROSOFT_ENTRA_ID_ID', 'AUTH_MICROSOFT_ENTRA_ID_SECRET']);
    expect(microsoftProvider.configured()).toBe(true);

    env.AUTH_MICROSOFT_ENTRA_ID_SECRET = '  ';

    expect(microsoftProvider.configured()).toBe(false);
    expect(() => microsoftProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'outlook-mail' })).toThrow(/not configured/);
  });

  it('serves the five Microsoft 365 connectors, and the connect registry finds it for each', () => {
    expect([...microsoftProvider.connectorSlugs].sort()).toEqual([...CONNECTORS].sort());

    for (const slug of CONNECTORS) {
      expect(providerForConnector(slug)?.id, slug).toBe('microsoft');
      expect(platformForConnectorSlug(slug)?.id, slug).toBe('microsoft');
    }
  });

  it('asks only for the connector it was started from, plus who is logging in and a refresh token', () => {
    const url = new URL(microsoftProvider.authorizeUrl({ state: 'st.ate', redirectUri: CALLBACK, connector: 'outlook-mail' }));

    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe('Mail.Read User.Read offline_access');
    expect(url.searchParams.get('client_id')).toBe('entra_client');
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('never asks for a permission the Entra app does not list, and only Teams asks for the admin-consent one', () => {
    for (const slug of CONNECTORS) {
      const scopes = new URL(microsoftProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: slug })).searchParams.get('scope')!.split(' ');
      for (const scope of scopes) {
        expect(REGISTERED.has(scope), `${slug}: ${scope}`).toBe(true);
      }

      expect(scopes.includes('ChannelMessage.Read.All'), slug).toBe(slug === 'microsoft-teams');
    }

    expect([...MICROSOFT_IDENTITY_SCOPES].every(scope => REGISTERED.has(scope))).toBe(true);
  });

  it('says on the Connectors form what each login asks for, the same scopes the login really sends', () => {
    for (const slug of CONNECTORS) {
      expect(howToConnectFor(slug)?.login?.access, slug).toEqual([...MICROSOFT_LOGIN_SCOPES[slug]!]);
    }
  });

  it('a login is enough everywhere but SharePoint, which still needs its site', () => {
    for (const slug of ['outlook-mail', 'outlook-calendar', 'microsoft-teams', 'onedrive']) {
      expect(loginIsEnough(slug), slug).toBe(true);
    }

    expect(loginIsEnough('sharepoint')).toBe(false);
    expect(howToConnectFor('sharepoint')?.login?.settingsAfterLogin).toEqual([{ key: 'site', label: 'SharePoint site' }]);
  });

  it('refuses a connector it does not serve', () => {
    expect(() => microsoftProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'gmail' })).toThrow(/does not serve/);
  });

  it('stores the tokens, the account, and the scope widened to everything consented so far', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at-code', refresh_token: 'rt-code', expires_in: 3599, scope: 'Mail.Read User.Read' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ displayName: 'Ann Lee', mail: 'ann@contoso.example', userPrincipalName: 'ann@contoso.example', id: 'user-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at-wide', refresh_token: 'rt-wide', expires_in: 3599, scope: 'Mail.Read Files.Read.All User.Read' })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'Microsoft — ann@contoso.example',
      credentials: { accessToken: 'at-wide', refreshToken: 'rt-wide', scope: 'Mail.Read Files.Read.All User.Read', account: 'ann@contoso.example', displayName: 'Ann Lee' },
    });

    const codeBody = new URLSearchParams(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

    expect(codeBody.get('grant_type')).toBe('authorization_code');
    expect(codeBody.get('redirect_uri')).toBe(CALLBACK);
    expect(codeBody.get('client_secret')).toBe('entra_value');

    const widenBody = new URLSearchParams(String((fetchMock.mock.calls[2] as [string, RequestInit])[1].body));

    expect(widenBody.get('grant_type')).toBe('refresh_token');
    expect(widenBody.get('scope')).toBe('https://graph.microsoft.com/.default offline_access');
  });

  it('keeps the code\'s own tokens when widening is refused, since they are good', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at-code', refresh_token: 'rt-code', expires_in: 3599, scope: 'Mail.Read User.Read' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userPrincipalName: 'ann@contoso.example' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_scope' }), { status: 400 })));

    const result = await microsoftProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK });

    expect(result).toMatchObject({ ok: true, credentials: { accessToken: 'at-code', refreshToken: 'rt-code', scope: 'Mail.Read User.Read', account: 'ann@contoso.example' } });
  });

  it('refuses a login Microsoft declined, or one whose account Graph will not name', async () => {
    expect(await microsoftProvider.exchange({ query: { error: 'access_denied', error_description: 'AADSTS65004 the user declined' }, redirectUri: CALLBACK }))
      .toEqual({ ok: false, reason: 'access_denied' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 })))
      .mockResolvedValueOnce(new Response('{}', { status: 403 })));

    expect(await microsoftProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK })).toEqual({ ok: false, reason: 'no_account' });
  });

  it('refreshes for every consented permission and keeps the rotated refresh token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 'Mail.Read Calendars.ReadWrite' })));
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await refreshMicrosoftGrant('rt-1');

    expect(tokens).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2', scope: 'Mail.Read Calendars.ReadWrite' });

    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));

    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('client_id')).toBe('entra_client');
  });

  it('names a stored login that lacks a connector\'s permissions, so a source is not saved to fail', () => {
    const outlookOnly = { refreshToken: 'rt', scope: 'Mail.Read User.Read', account: 'ann@contoso.example' };

    expect(microsoftProvider.missingAccessFor!(outlookOnly, 'outlook-mail')).toBeNull();
    expect(microsoftProvider.missingAccessFor!(outlookOnly, 'microsoft-teams')).toMatch(/doesn't include Microsoft Teams/);
    expect(microsoftProvider.missingAccessFor!({ ...outlookOnly, scope: 'https://graph.microsoft.com/Files.Read.All' }, 'onedrive')).toBeNull();
    expect(microsoftProvider.summarize(outlookOnly)).toEqual({ account: 'ann@contoso.example' });
    expect(microsoftProvider.summarize({ token: 'pasted' })).toBeNull();
  });
});
