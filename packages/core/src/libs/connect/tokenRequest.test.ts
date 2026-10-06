import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postTokenRequest, refusalFix, TokenRequestError } from './tokenRequest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the token request every vendor shares', () => {
  it('a refusal reports only the vendor\'s short error code, never its description, which can echo what was sent', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token r-secret-123 is revoked' }), { status: 400 }));

    const failure = await postTokenRequest({ vendor: 'HubSpot', url: 'https://api.hubapi.com/oauth/v1/token', params: { grant_type: 'refresh_token', refresh_token: 'r-secret-123' }, encoding: 'form' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TokenRequestError);
    expect((failure as Error).message).toBe('HubSpot refused the token request (invalid_grant).');
    expect((failure as Error).message).not.toContain('r-secret-123');
  });

  it('HubSpot\'s answer to a dead refresh token reads as invalid_grant, so the person is told to log in again rather than to wait for a retry', async () => {
    // HubSpot's live answer to a bad refresh token, 2026-10-06: `invalid_request`, not RFC 6749's `invalid_grant`.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ status: 'BAD_REFRESH_TOKEN', message: 'missing or invalid refresh token', error: 'invalid_request', error_description: 'missing or invalid refresh token' }), { status: 400 }));

    await expect(postTokenRequest({ vendor: 'HubSpot', url: 'https://api.hubapi.com/oauth/v1/token', params: { grant_type: 'refresh_token' }, encoding: 'form' })).rejects.toThrow('HubSpot refused the token request (invalid_grant).');
  });

  it('Zoom\'s answer to a spent refresh token reads as invalid_grant, but its internal error stays retryable', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reason: 'Invalid Token!', error: 'invalid_request' }), { status: 400 }));

    await expect(postTokenRequest({ vendor: 'Zoom', url: 'https://zoom.us/oauth/token', params: { grant_type: 'refresh_token' }, encoding: 'form' })).rejects.toThrow('Zoom refused the token request (invalid_grant).');

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reason: 'Internal Error', error: 'invalid_request' }), { status: 400 }));

    await expect(postTokenRequest({ vendor: 'Zoom', url: 'https://zoom.us/oauth/token', params: { grant_type: 'refresh_token' }, encoding: 'form' })).rejects.toThrow('Zoom refused the token request (invalid_request).');
  });

  it('one vendor\'s dead-token field never re-reads another vendor\'s invalid_request, which stays retryable', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reason: 'Invalid Token!', status: 'BAD_REFRESH_TOKEN', error: 'invalid_request' }), { status: 400 }));

    await expect(postTokenRequest({ vendor: 'Notion', url: 'https://api.notion.com/v1/oauth/token', params: { grant_type: 'refresh_token' }, encoding: 'json' })).rejects.toThrow('Notion refused the token request (invalid_request).');
  });

  it.each([
    ['invalid_grant', 'log-in-again'],
    ['http_401', 'log-in-again'],
    ['invalid_client', 'check-server-client'],
    ['unauthorized_client', 'check-server-client'],
    ['not_configured', 'check-server-client'],
    ['http_503', 'try-later'],
    ['timeout', 'try-later'],
    ['invalid_request', 'try-later'],
  ] as const)('a refusal of %s is fixed by %s', (code, fix) => {
    expect(refusalFix(new TokenRequestError('HubSpot', code, null))).toBe(fix);
  });

  it('a gateway page that is not JSON is reported by its status', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(postTokenRequest({ vendor: 'Zoom', url: 'https://zoom.us/oauth/token', params: {}, encoding: 'form' })).rejects.toThrow('Zoom refused the token request (http_502).');
  });

  it('sends the client as HTTP Basic when the vendor asks for it, with the body in the encoding it asks for', async () => {
    const sent: Array<{ headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: 'a1' }), { status: 200 });
    });

    const body = await postTokenRequest({ vendor: 'Notion', url: 'https://api.notion.com/v1/oauth/token', params: { grant_type: 'authorization_code', code: 'c1' }, encoding: 'json', basicAuth: { clientId: 'id', clientSecret: 'shh' } });

    expect(body).toEqual({ access_token: 'a1' });
    expect(sent[0]!.headers.authorization).toBe(`Basic ${Buffer.from('id:shh').toString('base64')}`);
    expect(sent[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(sent[0]!.body)).toEqual({ grant_type: 'authorization_code', code: 'c1' });
  });
});
