import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { slackProvider, SLACK_SOURCE_SCOPES } = await import('./slack');

describe('slack connect provider', () => {
  beforeEach(() => {
    env.SLACK_CLIENT_ID = 'client_1';
    env.SLACK_CLIENT_SECRET = 'secret_1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is configured only when both env vars are set', () => {
    expect(slackProvider.configured()).toBe(true);

    env.SLACK_CLIENT_SECRET = undefined;

    expect(slackProvider.configured()).toBe(false);
    expect(slackProvider.requiredEnv).toEqual(['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']);
  });

  it('sends the person to Slack with the source scopes, the callback and the state', () => {
    const url = new URL(slackProvider.authorizeUrl({ state: 'st.ate', redirectUri: 'https://v.example/api/connect/slack/callback' }));

    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client_1');
    expect(url.searchParams.get('scope')).toBe(SLACK_SOURCE_SCOPES.join(','));
    expect(url.searchParams.get('redirect_uri')).toBe('https://v.example/api/connect/slack/callback');
    expect(url.searchParams.get('state')).toBe('st.ate');
  });

  it('exchanges the code for the bot token and names the workspace', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      access_token: 'xoxb-1',
      scope: 'channels:read,channels:history',
      bot_user_id: 'U1',
      app_id: 'A1',
      team: { id: 'T1', name: 'Noco' },
    })));

    const result = await slackProvider.exchange({ query: { code: 'c0de' }, redirectUri: 'https://v.example/cb' });

    expect(result).toEqual({
      ok: true,
      displayName: 'Slack — Noco',
      credentials: { token: 'xoxb-1', teamId: 'T1', teamName: 'Noco', botUserId: 'U1', appId: 'A1', scope: 'channels:read,channels:history' },
    });

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://slack.com/api/oauth.v2.access');
    expect(String(init?.body)).toBe('client_id=client_1&client_secret=secret_1&code=c0de&redirect_uri=https%3A%2F%2Fv.example%2Fcb');
  });

  it('refuses with Slack\'s own error when the code is bad', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'invalid_code' })));

    await expect(slackProvider.exchange({ query: { code: 'stale' }, redirectUri: 'https://v.example/cb' }))
      .resolves
      .toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('refuses without calling Slack when the person cancelled or no code came back', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(slackProvider.exchange({ query: { error: 'access_denied' }, redirectUri: 'https://v.example/cb' }))
      .resolves
      .toEqual({ ok: false, reason: 'access_denied' });
    await expect(slackProvider.exchange({ query: {}, redirectUri: 'https://v.example/cb' }))
      .resolves
      .toEqual({ ok: false, reason: 'missing_code' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('summarizes a grant as the workspace it is on, and nothing for a pasted bot token', () => {
    expect(slackProvider.summarize({ token: 'xoxb-1', teamId: 'T1', teamName: 'Metacto', botUserId: 'U1', appId: 'A1', scope: 'channels:read' }))
      .toEqual({ account: 'Metacto (Slack workspace)' });
    expect(slackProvider.summarize({ token: 'xoxb-1' })).toBeNull();
  });
});
