import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { googleProvider, GOOGLE_LOGIN_SCOPES } = await import('./google');

const CALLBACK = 'https://v.example/api/connect/google/callback';

describe('google connect provider', () => {
  beforeEach(() => {
    env.GOOGLE_OAUTH_CLIENT_ID = 'client_1';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret_1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is configured only when both env vars are set, and refuses to build a login URL otherwise', () => {
    expect(googleProvider.configured()).toBe(true);

    env.GOOGLE_OAUTH_CLIENT_SECRET = '';

    expect(googleProvider.configured()).toBe(false);
    expect(() => googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'gmail' })).toThrow(/not configured/);
  });

  it('asks only for the connector it was started from, plus who is logging in', () => {
    const url = new URL(googleProvider.authorizeUrl({ state: 'st.ate', redirectUri: CALLBACK, connector: 'drive' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly openid email');
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
  });

  it('asks for a refresh token every time, so a repeat login does not strand the connector', () => {
    const url = new URL(googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'gmail' }));

    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });

  it('never offers Google Ads or an unknown connector a login', () => {
    expect(() => googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'google-ads' })).toThrow(/does not serve/);
    expect(googleProvider.connectorSlugs).not.toContain('google-ads');
  });

  it('stores the tokens, the granted scope and the account email from a successful login', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ya29.a', refresh_token: '1//r', expires_in: 3599, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'ann@noco.example' })));

    const result = await googleProvider.exchange({ query: { code: 'c0de' }, redirectUri: CALLBACK });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'Google — ann@noco.example',
      credentials: { accessToken: 'ya29.a', refreshToken: '1//r', scope: 'openid email https://www.googleapis.com/auth/gmail.readonly', email: 'ann@noco.example' },
    });
    expect(result.ok && Date.parse(String(result.credentials.expiresAt))).toBeGreaterThan(Date.now());
  });

  it('refuses a login that came back without a refresh token, which would die in an hour', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ya29.a', expires_in: 3599 })));

    expect(await googleProvider.exchange({ query: { code: 'c' }, redirectUri: CALLBACK })).toEqual({ ok: false, reason: 'no_refresh_token' });
  });

  it('reports the person declining, and a callback with no code, without calling Google', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    expect(await googleProvider.exchange({ query: { error: 'access_denied' }, redirectUri: CALLBACK })).toEqual({ ok: false, reason: 'access_denied' });
    expect(await googleProvider.exchange({ query: {}, redirectUri: CALLBACK })).toEqual({ ok: false, reason: 'missing_code' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never repeats unsafe error text from the callback URL', async () => {
    const result = await googleProvider.exchange({ query: { error: '<script>alert(1)</script>' }, redirectUri: CALLBACK });

    expect(result).toEqual({ ok: false, reason: 'login_refused' });
  });

  it('gives Google\'s own error code when the token request is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad code ya29.leak' }), { status: 400 }));

    expect(await googleProvider.exchange({ query: { code: 'used' }, redirectUri: CALLBACK })).toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('summarizes a login by its email, and a pasted bag as not a login', () => {
    expect(googleProvider.summarize({ email: 'ann@noco.example', refreshToken: '1//r' })).toEqual({ account: 'ann@noco.example' });
    expect(googleProvider.summarize({ clientId: 'c', clientSecret: 's', refreshToken: '1//r' })).toBeNull();
  });

  it('says what is missing when a login was made for another Google connector', () => {
    const driveOnly = { scope: `openid email ${GOOGLE_LOGIN_SCOPES.drive!.join(' ')}` };

    expect(googleProvider.missingAccessFor!(driveOnly, 'drive')).toBeNull();
    expect(googleProvider.missingAccessFor!(driveOnly, 'gmail')).toBe(
      'This Google login doesn\'t include Gmail. Press Replace and log in with Google again to add it.',
    );
  });
});

describe('google connect provider — a person\'s own login', () => {
  beforeEach(() => {
    for (const key of ['GOOGLE_PERSONAL_CLIENT_ID', 'GOOGLE_PERSONAL_CLIENT_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
      env[key] = undefined;
    }
  });

  it('runs on the personal app, else the sign-in app, else the connectors\' app', () => {
    const clientOf = () => new URL(googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'gmail', audience: 'personal' })).searchParams.get('client_id');
    env.GOOGLE_OAUTH_CLIENT_ID = 'connectors';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'x';

    expect(clientOf()).toBe('connectors');

    env.AUTH_GOOGLE_ID = 'sign-in';
    env.AUTH_GOOGLE_SECRET = 'x';

    expect(clientOf()).toBe('sign-in');

    env.GOOGLE_PERSONAL_CLIENT_ID = 'personal';
    env.GOOGLE_PERSONAL_CLIENT_SECRET = 'x';

    expect(clientOf()).toBe('personal');
    expect(googleProvider.personal?.configured()).toBe(true);
  });

  it('is not offered when no Google app is set up anywhere', () => {
    expect(googleProvider.personal?.configured()).toBe(false);
  });

  it('asks Gmail for read plus drafts, and Calendar and Drive for read only', () => {
    env.GOOGLE_PERSONAL_CLIENT_ID = 'personal';
    env.GOOGLE_PERSONAL_CLIENT_SECRET = 'x';
    const scope = (connector: string) => new URL(googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector, audience: 'personal' })).searchParams.get('scope');

    expect(scope('gmail')).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose openid email');
    expect(scope('google-calendar')).toBe('https://www.googleapis.com/auth/calendar.events.readonly openid email');
    expect(scope('drive')).toBe('https://www.googleapis.com/auth/drive.readonly openid email');

    // A workspace's Gmail is read-only by default; a reconnect asks for drafts (below).
    env.GOOGLE_OAUTH_CLIENT_ID = 'connectors';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'x';

    expect(new URL(googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector: 'gmail' })).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly openid email');
  });

  it('a reconnect that asks for compose adds drafts, once, and only for Gmail', () => {
    env.GOOGLE_OAUTH_CLIENT_ID = 'connectors';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'x';
    env.GOOGLE_PERSONAL_CLIENT_ID = 'personal';
    env.GOOGLE_PERSONAL_CLIENT_SECRET = 'y';
    const scope = (connector: string, audience?: 'personal') => new URL(googleProvider.authorizeUrl({ state: 's', redirectUri: CALLBACK, connector, access: 'compose', ...(audience ? { audience } : {}) })).searchParams.get('scope');

    // The workspace flow asks for what the failed draft needed.
    expect(scope('gmail')).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose openid email');
    // The personal flow already asks for it, and asks once.
    expect(scope('gmail', 'personal')).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose openid email');
    // A name a connector does not declare asks for nothing extra.
    expect(scope('drive')).toBe('https://www.googleapis.com/auth/drive.readonly openid email');
  });

  it('a Calendar login made with the broader calendar.readonly still serves, personal and workspace', () => {
    const legacy = { scope: 'https://www.googleapis.com/auth/calendar.readonly openid email' };
    const narrow = { scope: 'https://www.googleapis.com/auth/calendar.events.readonly openid email' };

    expect(googleProvider.missingAccessFor?.(legacy, 'google-calendar', 'personal')).toBeNull();
    expect(googleProvider.missingAccessFor?.(legacy, 'google-calendar')).toBeNull();
    expect(googleProvider.missingAccessFor?.(narrow, 'google-calendar', 'personal')).toBeNull();
    expect(googleProvider.missingAccessFor?.({ scope: 'https://www.googleapis.com/auth/gmail.readonly openid email' }, 'google-calendar', 'personal')).toMatch(/doesn't include Google Calendar/);
  });

  it('a personal Gmail login whose consent left out drafts is missing access', () => {
    const readOnly = { scope: 'https://www.googleapis.com/auth/gmail.readonly openid email' };

    expect(googleProvider.missingAccessFor?.(readOnly, 'gmail', 'personal')).toMatch(/doesn't include Gmail/);
    expect(googleProvider.missingAccessFor?.(readOnly, 'gmail')).toBeNull();
  });
});
