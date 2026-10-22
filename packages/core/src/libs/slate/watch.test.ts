import type { SlateCredentials, SlateFetch } from './client';
import { describe, expect, it } from 'vitest';
import { findNewRecording, SLATE_CHROME_EXTENSION_ID, slateRecordUrl } from './watch';

const C: SlateCredentials = { token: 'slt_fixture_token_0001', apiBase: 'https://api.video-host.example' };

/**
 * A Slate MCP double that answers `find_videos` with `videos`, and records the arguments.
 * @param videos - What the search finds.
 * @param status - An HTTP status for the tool call instead.
 */
function fakeSearch(videos: unknown[], status = 200): { doFetch: SlateFetch; asked: Array<Record<string, unknown>> } {
  const asked: Array<Record<string, unknown>> = [];
  const doFetch: SlateFetch = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { arguments?: Record<string, unknown> } };
    let text = '';
    let code = 200;
    if (body.method === 'initialize') {
      text = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } });
    } else if (body.method === 'tools/call') {
      asked.push(body.params?.arguments ?? {});
      code = status;
      text = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ total: videos.length, videos, nextCursor: null }, null, 2) }] } });
    } else {
      code = 202;
    }
    return { ok: code < 300, status: code, json: async () => JSON.parse(text), text: async () => text, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) } };
  };
  return { doFetch, asked };
}

const video = (over: Record<string, unknown>) => ({
  id: '01a00000-0000-7000-8000-000000000001',
  shareId: 'Fx7share0001',
  url: 'https://slate.video-host.example/v/Fx7share0001',
  title: 'Dana Kestrel - Oct 22, 9:14 AM',
  summary: null,
  kind: 'screen',
  status: 'processing',
  createdAt: '2026-10-22T16:14:05.000Z',
  owner: 'Dana Kestrel',
  yours: true,
  transcript: 'pending',
  ...over,
});

describe('launching a recording', () => {
  it('opens the target page and names the extension\'s hotkey, the Mac panel and the web recorder', () => {
    const launch = slateRecordUrl({ title: 'Reconcile Contoso invoices', targetUrl: 'https://portal.contoso.example/invoices' });

    expect(launch).toMatchObject({
      targetUrl: 'https://portal.contoso.example/invoices',
      extension: { id: SLATE_CHROME_EXTENSION_ID, hotkey: { mac: '⌥⇧R', other: 'Alt+Shift+R' } },
      macPanelUrl: 'slate://panel',
      webRecorderUrl: 'https://slatevideo.com/library',
      titleHint: 'Reconcile Contoso invoices',
    });
    expect(launch.instruction).toMatch(/portal\.contoso\.example tab/);
  });

  it('follows the API origin to the web origin, and refuses a target that is not a web page', () => {
    expect(slateRecordUrl({ apiBase: 'https://dev-api.video-host.example' }).webRecorderUrl).toBe('https://dev.video-host.example/library');
    expect(slateRecordUrl({ apiBase: 'http://localhost:3000' }).webRecorderUrl).toBe('http://localhost:5173/library');
    expect(slateRecordUrl({ webBase: 'https://slate.video-host.example/' }).webRecorderUrl).toBe('https://slate.video-host.example/library');
    expect(slateRecordUrl({ targetUrl: 'javascript:alert(1)' }).targetUrl).toBeNull();
  });
});

describe('finding the finished recording', () => {
  const since = new Date('2026-10-22T16:14:00.000Z');

  it('asks for the person\'s own recordings since the launch, newest first', async () => {
    const { doFetch, asked } = fakeSearch([]);

    expect(await findNewRecording(C, { since }, doFetch)).toEqual({ ok: true, data: null });
    expect(asked).toEqual([{ mine: true, since: '2026-10-22T16:14:00.000Z', sort: 'newest', limit: 10 }]);
  });

  it('is not ready while processing, and ready once the video and its transcript are', async () => {
    const processing = fakeSearch([video({})]);

    expect(await findNewRecording(C, { since }, processing.doFetch)).toMatchObject({ ok: true, data: { ready: false, failed: false, status: 'processing', transcript: 'pending' } });

    const done = fakeSearch([video({ status: 'ready', transcript: 'ready', title: 'Reconciling Contoso invoices' })]);

    expect(await findNewRecording(C, { since }, done.doFetch)).toEqual({
      ok: true,
      data: { url: 'https://slate.video-host.example/v/Fx7share0001', id: '01a00000-0000-7000-8000-000000000001', title: 'Reconciling Contoso invoices', createdAt: '2026-10-22T16:14:05.000Z', ready: true, status: 'ready', transcript: 'ready', failed: false },
    });

    const broken = fakeSearch([video({ status: 'failed', transcript: 'none' })]);

    expect(await findNewRecording(C, { since }, broken.doFetch)).toMatchObject({ ok: true, data: { ready: false, failed: true } });
  });

  it('prefers the one matching the hint, ignores older ones and teammates\', else takes the newest', async () => {
    const list = [
      video({ id: 'v-team', url: 'https://slate.video-host.example/v/team', createdAt: '2026-10-22T16:20:00.000Z', yours: false }),
      video({ id: 'v-new', url: 'https://slate.video-host.example/v/new', createdAt: '2026-10-22T16:18:00.000Z' }),
      video({ id: 'v-hint', url: 'https://slate.video-host.example/v/hint', createdAt: '2026-10-22T16:15:00.000Z', summary: 'Reconciling Contoso invoices in the portal.' }),
      video({ id: 'v-old', url: 'https://slate.video-host.example/v/old', createdAt: '2026-10-22T16:00:00.000Z' }),
    ];
    const hinted = await findNewRecording(C, { since, titleHint: 'contoso invoices' }, fakeSearch(list).doFetch);

    expect(hinted.ok && hinted.data?.id).toBe('v-hint');

    const newest = await findNewRecording(C, { since, titleHint: 'nothing like it' }, fakeSearch(list).doFetch);

    expect(newest.ok && newest.data?.id).toBe('v-new');
  });

  it('passes a refusal through', async () => {
    expect(await findNewRecording(C, { since }, fakeSearch([], 401).doFetch)).toMatchObject({ ok: false, status: 401 });
  });
});
