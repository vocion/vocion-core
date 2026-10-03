import type { SlateCredentials, SlateFetch } from './client';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { readSlateMe, setSlateVisibility, SLATE_PART_BYTES, slateCredentialsFrom, slateVisibilityFrom, uploadSlateVideo } from './client';
import { slateHostFor } from './videoHost';

const C: SlateCredentials = { token: 'slt_fixture_token_0001', apiBase: 'https://api.video-host.example', webOrigin: 'https://video-host.example' };

type Call = { url: string; method: string; headers: Record<string, string>; body?: string | Uint8Array };

/**
 * A Slate API double: answers by `METHOD path`, records every call.
 * @param table
 */
function fake(table: Record<string, (call: Call) => { status?: number; json?: unknown; etag?: string }>): { doFetch: SlateFetch; calls: Call[] } {
  const calls: Call[] = [];
  const doFetch: SlateFetch = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const u = new URL(url);
    const key = `${init.method} ${u.host === 'uploads.video-host.example' ? 'PART' : u.pathname}`;
    const handler = table[key];
    const r = handler ? handler(call) : { status: 404, json: { message: 'no route' } };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json ?? {},
      text: async () => JSON.stringify(r.json ?? {}),
      headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? r.etag ?? null : null) },
    };
  };
  return { doFetch, calls };
}

describe('the slate credential', () => {
  it('needs a token, defaults the two addresses, and reads the OAuth slots when present', () => {
    expect(slateCredentialsFrom({})).toMatchObject({ ok: false, message: expect.stringMatching(/No Slate token/) });
    expect(slateCredentialsFrom({ token: ' slt_x ' })).toEqual({ ok: true, credentials: { token: 'slt_x', apiBase: 'https://api.slatevideo.com', webOrigin: 'https://slatevideo.com' } });
    expect(slateCredentialsFrom({ token: 'slt_x', refreshToken: 'slr_y' }, { apiBase: 'https://api.video-host.example/' })).toMatchObject({ ok: true, credentials: { apiBase: 'https://api.video-host.example', refreshToken: 'slr_y' } });
    expect(slateCredentialsFrom({ token: 'slt_x' }, { webOrigin: 'not a url' }).ok).toBe(false);
  });

  it('shares with the team unless told otherwise, and never takes an unknown visibility', () => {
    expect(slateVisibilityFrom(undefined)).toBe('team');
    expect(slateVisibilityFrom('invited')).toBe('team');
    expect(slateVisibilityFrom('public')).toBe('public');
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
});

describe('uploading a recording', () => {
  function happy(partCount: number) {
    return fake({
      'POST /v1/videos': () => ({ json: { videoId: 'vid-1', shareId: 'share-fictional-1', uploadId: 'up-1', parts: Array.from({ length: partCount }, (_, i) => ({ partNumber: i + 1, url: `https://uploads.video-host.example/raw?part=${i + 1}` })) } }),
      'PUT PART': call => ({ etag: `"etag-${new URL(call.url).searchParams.get('part')}"` }),
      'POST /v1/videos/vid-1/complete': () => ({ json: { id: 'vid-1', shareId: 'share-fictional-1', status: 'processing' } }),
      'PATCH /v1/videos/vid-1': () => ({ json: { id: 'vid-1', visibility: 'team' } }),
    });
  }

  it('opens the upload, puts each part to its presigned URL, finishes from the ETags, then sets title, summary and team visibility', async () => {
    const { doFetch, calls } = happy(2);
    const data = Buffer.alloc(SLATE_PART_BYTES + 10, 1);
    const r = await uploadSlateVideo(C, { data, contentType: 'video/webm', title: 'FE-41 · Live check of REL-9', summary: 'Live check of REL-9, 2026-09-20', visibility: 'team' }, doFetch);

    expect(r).toEqual({ ok: true, data: { videoId: 'vid-1', shareId: 'share-fictional-1', watchUrl: 'https://video-host.example/v/share-fictional-1', embedUrl: 'https://video-host.example/embed/share-fictional-1', visibility: 'team' } });
    expect(calls.map(c => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /v1/videos', 'PUT /raw', 'PUT /raw', 'POST /v1/videos/vid-1/complete', 'PATCH /v1/videos/vid-1']);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ contentType: 'video/webm', title: 'FE-41 · Live check of REL-9', partCount: 2, source: 'upload', visibility: 'team' });
    // The presigned part URLs carry their own signature: no bearer goes to the storage host.
    expect(calls[1]!.headers.Authorization).toBeUndefined();
    expect((calls[1]!.body as Uint8Array).byteLength).toBe(SLATE_PART_BYTES);
    expect((calls[2]!.body as Uint8Array).byteLength).toBe(10);
    expect(JSON.parse(calls[3]!.body as string)).toEqual({ parts: [{ partNumber: 1, etag: '"etag-1"' }, { partNumber: 2, etag: '"etag-2"' }], title: 'FE-41 · Live check of REL-9' });
    expect(JSON.parse(calls[4]!.body as string)).toEqual({ title: 'FE-41 · Live check of REL-9', summary: 'Live check of REL-9, 2026-09-20', visibility: 'team' });
  });

  it('says a refused upload (no paid seat) as Slate said it, and does not retry through another door', async () => {
    const { doFetch, calls } = fake({ 'POST /v1/videos': () => ({ status: 402, json: { message: 'Uploading a video comes with a paid seat.' } }) });
    const r = await uploadSlateVideo(C, { data: Buffer.from('x'), contentType: 'video/webm', title: 't', summary: null, visibility: 'team' }, doFetch);

    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(r.ok ? '' : r.message).toMatch(/paid seat/);
    expect(calls).toHaveLength(1);
  });

  it('calls a storage failure retryable, and never finishes an upload with a part missing', async () => {
    const { doFetch, calls } = fake({
      'POST /v1/videos': () => ({ json: { videoId: 'vid-2', shareId: 's2', parts: [{ partNumber: 1, url: 'https://uploads.video-host.example/raw?part=1' }] } }),
      'PUT PART': () => ({ status: 503 }),
    });
    const r = await uploadSlateVideo(C, { data: Buffer.from('x'), contentType: 'video/webm', title: 't', summary: null, visibility: 'team' }, doFetch);

    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(calls.some(c => c.url.includes('/complete'))).toBe(false);
  });

  it('refuses what Slate does not take, before any call', async () => {
    const { doFetch, calls } = happy(1);

    await expect(uploadSlateVideo(C, { data: Buffer.from('x'), contentType: 'image/png', title: 't', summary: null, visibility: 'team' }, doFetch)).resolves.toMatchObject({ ok: false, retryable: false });
    await expect(uploadSlateVideo(C, { data: Buffer.alloc(0), contentType: 'video/webm', title: 't', summary: null, visibility: 'team' }, doFetch)).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe('changing who may watch', () => {
  it('patches one recording\'s visibility and answers with what Slate now reports', async () => {
    const { doFetch, calls } = fake({ 'PATCH /v1/videos/vid-7': () => ({ json: { id: 'vid-7', visibility: 'public' } }) });

    await expect(setSlateVisibility(C, 'vid-7', 'public', doFetch)).resolves.toEqual({ ok: true, data: { visibility: 'public' } });
    expect(calls.map(c => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['PATCH /v1/videos/vid-7']);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ visibility: 'public' });
    expect(calls[0]!.headers.Authorization).toBe('Bearer slt_fixture_token_0001');
  });

  it('says why when Slate cannot be reached, without throwing', async () => {
    const doFetch: SlateFetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };

    await expect(setSlateVisibility(C, 'vid-7', 'public', doFetch)).resolves.toMatchObject({ ok: false, retryable: true, message: expect.stringMatching(/could not be reached/) });
  });

  it('as a video host: public for a shared page, the workspace\'s choice otherwise', async () => {
    const { doFetch, calls } = fake({ 'PATCH /v1/videos/vid-7': call => ({ json: { visibility: JSON.parse(call.body as string).visibility } }) });
    const host = slateHostFor(C, 'signedIn', doFetch);

    await expect(host.setAudience('vid-7', 'public')).resolves.toEqual({ ok: true, visibility: 'public' });
    await expect(host.setAudience('vid-7', 'workspace')).resolves.toEqual({ ok: true, visibility: 'signedIn' });
    expect(calls.map(c => JSON.parse(c.body as string).visibility)).toEqual(['public', 'signedIn']);
  });

  it('as a video host: uploads public when asked for a public audience', async () => {
    const { doFetch, calls } = fake({
      'POST /v1/videos': () => ({ json: { videoId: 'vid-1', shareId: 'share-fictional-1', parts: [{ partNumber: 1, url: 'https://uploads.video-host.example/raw?part=1' }] } }),
      'PUT PART': () => ({ etag: '"etag-1"' }),
      'POST /v1/videos/vid-1/complete': () => ({ json: { id: 'vid-1' } }),
      'PATCH /v1/videos/vid-1': () => ({ json: { visibility: 'public' } }),
    });
    const r = await slateHostFor(C, 'team', doFetch).publish({ data: Buffer.from('x'), contentType: 'video/webm', title: 't', summary: null, audience: 'public' });

    expect(r).toMatchObject({ ok: true, visibility: 'public' });
    expect(JSON.parse(calls[0]!.body as string).visibility).toBe('public');
    expect(JSON.parse(calls[3]!.body as string).visibility).toBe('public');
  });
});
