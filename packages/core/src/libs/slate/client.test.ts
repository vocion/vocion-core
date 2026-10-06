import type { SlateCredentials, SlateFetch } from './client';
import { describe, expect, it } from 'vitest';
import { readSlateMe, slateCredentialsFrom } from './client';

const C: SlateCredentials = { token: 'slt_fixture_token_0001', apiBase: 'https://api.video-host.example' };

type Call = { url: string; method: string; headers: Record<string, string>; body?: string | Uint8Array };

/**
 * A Slate API double: answers by `METHOD path`, records every call.
 * @param table
 */
function fake(table: Record<string, (call: Call) => { status?: number; json?: unknown }>): { doFetch: SlateFetch; calls: Call[] } {
  const calls: Call[] = [];
  const doFetch: SlateFetch = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const handler = table[`${init.method} ${new URL(url).pathname}`];
    const r = handler ? handler(call) : { status: 404, json: { message: 'no route' } };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json ?? {},
      text: async () => JSON.stringify(r.json ?? {}),
      headers: { get: () => null },
    };
  };
  return { doFetch, calls };
}

describe('the slate credential', () => {
  it('needs a token, defaults the API address, and reads the OAuth slots when present', () => {
    expect(slateCredentialsFrom({})).toMatchObject({ ok: false, message: expect.stringMatching(/No Slate token/) });
    expect(slateCredentialsFrom({ token: ' slt_x ' })).toEqual({ ok: true, credentials: { token: 'slt_x', apiBase: 'https://api.slatevideo.com' } });
    expect(slateCredentialsFrom({ token: 'slt_x', refreshToken: 'slr_y' }, { apiBase: 'https://api.video-host.example/' })).toMatchObject({ ok: true, credentials: { apiBase: 'https://api.video-host.example', refreshToken: 'slr_y' } });
    expect(slateCredentialsFrom({ token: 'slt_x' }, { apiBase: 'not a url' }).ok).toBe(false);
  });
});

describe('reading the account', () => {
  it('sends the bearer token to /v1/me', async () => {
    const { doFetch, calls } = fake({ 'GET /v1/me': () => ({ json: { id: 'u1', email: 'dana@northwind.example', paidSeat: true } }) });

    await expect(readSlateMe(C, doFetch)).resolves.toEqual({ ok: true, data: { id: 'u1', email: 'dana@northwind.example', paidSeat: true } });
    expect(calls[0]!.headers.Authorization).toBe('Bearer slt_fixture_token_0001');
  });

  it('says an expired token is one to paste again, and is not worth retrying', async () => {
    const { doFetch } = fake({ 'GET /v1/me': () => ({ status: 401, json: { message: 'Session expired' } }) });
    const r = await readSlateMe(C, doFetch);

    expect(r).toMatchObject({ ok: false, status: 401, retryable: false });
    expect(r.ok ? '' : r.message).toMatch(/Paste a new one.*Session expired/);
  });

  it('says why when Slate cannot be reached, without throwing', async () => {
    const doFetch: SlateFetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };

    await expect(readSlateMe(C, doFetch)).resolves.toMatchObject({ ok: false, status: null, retryable: true, message: expect.stringMatching(/could not be reached/) });
  });
});
