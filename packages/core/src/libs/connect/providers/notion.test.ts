import type { SourceContext } from '@/libs/sources/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant imports the database; the exchange never touches it.
vi.mock('@/libs/DB', () => ({ db: {} }));

const { notionProvider } = await import('./notion');
const { notionConnector } = await import('@/libs/sources/notion');
const { DEFAULT_NOTION_VERSION } = await import('@/libs/sources/notionVersion');

const REDIRECT = 'https://v.example/api/connect/notion/callback';

/**
 * Run one Notion sync against a stubbed search and return the Authorization header it sent.
 * @param credentials - The credential bag the sync runs with.
 */
async function authorizationHeaderOfSync(credentials: Record<string, unknown>): Promise<string> {
  const fetchStub = vi.fn(async () => new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), { status: 200 }));
  vi.stubGlobal('fetch', fetchStub);
  const context = { orgId: 'org_1', sourceId: 1, config: {}, credentials, since: null } as unknown as SourceContext;
  for await (const _doc of notionConnector.sync(context)) {
    // Only the request matters here.
  }
  const headers = (fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
  return headers.authorization!;
}

/**
 * Run one Notion sync to its end, for a test that only cares how it ends.
 * @param context - The sync's context.
 */
async function runSync(context: SourceContext): Promise<void> {
  for await (const _doc of notionConnector.sync(context)) {
    // Only how the sync ends matters here.
  }
}

describe('notion connect provider', () => {
  beforeEach(() => {
    env.NOTION_CLIENT_ID = 'nid';
    env.NOTION_CLIENT_SECRET = 'nsecret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is configured only when both env vars are set', () => {
    expect(notionProvider.configured()).toBe(true);

    env.NOTION_CLIENT_SECRET = undefined;

    expect(notionProvider.configured()).toBe(false);
  });

  it('sends the person to Notion as a user-owned public integration with our state', () => {
    const url = new URL(notionProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'notion' }));

    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'nid', redirect_uri: REDIRECT, response_type: 'code', owner: 'user', state: 'st.ate' });
  });

  it('stores the bot token under `token` with the workspace, and names the workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'ntn_abc',
      refresh_token: 'ref_1',
      bot_id: 'b1',
      workspace_id: 'w1',
      workspace_name: 'Noco',
    }), { status: 200 })));

    const result = await notionProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(result).toEqual({
      ok: true,
      displayName: 'Notion — Noco',
      credentials: { token: 'ntn_abc', refreshToken: 'ref_1', workspaceId: 'w1', workspaceName: 'Noco', botId: 'b1' },
    });
    expect(result.ok && notionProvider.summarize(result.credentials)).toEqual({ account: 'Noco (Notion workspace)' });
  });

  it('sends the Notion-Version header Notion\'s token endpoint requires, at the version the sync reads with', async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ access_token: 'ntn_abc', bot_id: 'b1', workspace_id: 'w1', workspace_name: 'Noco' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    await notionProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    const headers = (fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

    expect(headers['Notion-Version']).toBe(DEFAULT_NOTION_VERSION);
  });

  it('omits the refresh token when Notion sends null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'ntn_abc', refresh_token: null, workspace_id: 'w1', workspace_name: 'Noco' }), { status: 200 })));

    const result = await notionProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(result.ok && 'refreshToken' in result.credentials).toBe(false);
  });

  it('refuses with a short code when Notion refuses, and never leaks the vendor text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secret echo' }), { status: 400 })));

    await expect(notionProvider.exchange({ query: { code: 'stale' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('refuses without calling Notion when the person declined or no code came back', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    await expect(notionProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
    await expect(notionProvider.exchange({ query: { error: 'has spaces & echo' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'authorization_refused' });
    await expect(notionProvider.exchange({ query: {}, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_code' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('shows no account for a pasted token', () => {
    expect(notionProvider.summarize({ token: 'ntn_pasted' })).toBeNull();
  });

  it('a revoked Notion token ends the sync naming who fixes it and where, since a member cannot reconnect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"object":"error","status":401}', { status: 401 })));
    const context = { orgId: 'org_1', sourceId: 1, config: {}, credentials: { token: 'ntn_revoked' }, since: null } as unknown as SourceContext;

    await expect(runSync(context)).rejects.toThrow('An admin needs to press Reconnect on the Connectors page and log in with Notion again');
  });

  it('syncs with a login bag and a pasted token alike, as a Bearer', async () => {
    await expect(authorizationHeaderOfSync({ token: 'ntn_pasted' })).resolves.toBe('Bearer ntn_pasted');
    await expect(authorizationHeaderOfSync({ token: 'ntn_login', workspaceId: 'w1', workspaceName: 'Noco', botId: 'b1' })).resolves.toBe('Bearer ntn_login');
  });
});
