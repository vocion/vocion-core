import type { SlateCredentials, SlateFetch } from './client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseActivity, parseMoment, parseTranscript, parseVideo, readSlateRecording, slateFrames, slateTool } from './recording';

const C: SlateCredentials = { token: 'slt_fixture_token_0001', apiBase: 'https://api.video-host.example' };
const LINK = 'https://slate.video-host.example/v/Fx7share0001';

// Shapes as Slate's MCP answers them (2026-10-22), with fixture values.
const VIDEO_TEXT = JSON.stringify({
  id: '01a00000-0000-7000-8000-000000000001',
  shareId: 'Fx7share0001',
  url: LINK,
  title: 'Northwind invoice portal walkthrough',
  titleSource: 'ai',
  summary: 'Reading invoices from a portal with no API.',
  kind: 'screen',
  status: 'ready',
  durationSec: 34.901667,
  owner: { id: 'u-1', name: 'Dana Kestrel', email: 'dana@northwind.example' },
  submitterName: null,
  transcript: 'ready',
  links: [{ url: 'https://portal.northwind.example/', title: 'Northwind Portal', at: 1.03, atLabel: '0:01' }],
  chapters: [],
  appsOnScreen: ['Google Chrome'],
  next: ['get_transcript for what was said'],
}, null, 2);

const TRANSCRIPT_TEXT = `"Northwind invoice portal walkthrough", 0:34 long, language en-US, 3 of 3 lines

[0:00] So this portal has no API.
[0:07] I sign in and open the invoices.
[1:02:03] And that is the last one.`;

const ACTIVITY_TEXT = JSON.stringify({
  moments: [{ at: 1.03, atLabel: '0:01', app: 'Google Chrome', title: 'Northwind Portal', url: 'https://portal.northwind.example/' }],
  links: [{ url: 'https://portal.northwind.example/', title: 'Northwind Portal', at: 1.03 }],
}, null, 2);

const NO_ACTIVITY_TEXT = JSON.stringify({ moments: [], note: 'Nothing was recorded about what was on screen for this recording.' }, null, 2);

type Call = { url: string; method: string; headers: Record<string, string>; body: { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } } };
type Reply = { status?: number; headers?: Record<string, string>; body?: string };

/**
 * A Slate MCP double: answers JSON-RPC by method (and tool name), records every call.
 * @param tools - Tool name → its result (or an HTTP reply to send instead).
 * @param opts - How to answer: `sse` streams replies; `initialize` overrides the handshake.
 * @param opts.sse - Answer requests as text/event-stream.
 * @param opts.initialize - Override the initialize reply.
 */
function fake(tools: Record<string, (args: Record<string, unknown>) => unknown>, opts: { sse?: boolean; initialize?: Reply } = {}): { doFetch: SlateFetch; calls: Call[] } {
  const calls: Call[] = [];
  const doFetch: SlateFetch = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Call['body'];
    calls.push({ url, method: init.method, headers: init.headers, body });
    let reply: Reply;
    if (body.method === 'initialize') {
      reply = opts.initialize ?? { headers: { 'mcp-session-id': 'sess-1' }, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'slate' } } }) };
    } else if (body.method === 'notifications/initialized') {
      reply = { status: 202, body: '' };
    } else {
      const handler = tools[body.params?.name ?? ''];
      const result = handler ? handler(body.params?.arguments ?? {}) : { isError: true, content: [{ type: 'text', text: 'Unknown tool.' }] };
      reply = (result as { http?: Reply }).http ?? { body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) };
    }
    const status = reply.status ?? 200;
    const headers: Record<string, string> = { 'content-type': 'application/json', ...reply.headers };
    let text = reply.body ?? '';
    if (opts.sse && status === 200 && body.id !== undefined) {
      headers['content-type'] = 'text/event-stream';
      // A progress notification first, then the reply, as a stream would.
      text = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${text}\n\n`;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    };
  };
  return { doFetch, calls };
}

const textResult = (text: string) => ({ content: [{ type: 'text', text }] });

describe('the session', () => {
  it('initializes, acknowledges, then calls the tool with the session id, bearer and negotiated protocol', async () => {
    const { doFetch, calls } = fake({ get_me: () => textResult('{"email":"dana@northwind.example"}') });
    const r = await slateTool(C, 'get_me', {}, doFetch);

    expect(r).toEqual({ ok: true, data: { text: '{"email":"dana@northwind.example"}', images: [] } });
    expect(calls.map(c => c.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(calls.every(c => c.url === 'https://api.video-host.example/mcp' && c.method === 'POST')).toBe(true);
    expect(calls.every(c => c.headers.Authorization === `Bearer ${C.token}` && c.headers.Accept === 'application/json, text/event-stream')).toBe(true);
    expect(calls[0]!.headers['Mcp-Session-Id']).toBeUndefined();
    expect(calls[0]!.body.params).toMatchObject({ protocolVersion: '2025-06-18', clientInfo: { name: 'vocion' } });
    expect(calls[1]!.headers['Mcp-Session-Id']).toBe('sess-1');
    expect(calls[2]!.headers).toMatchObject({ 'Mcp-Session-Id': 'sess-1', 'MCP-Protocol-Version': '2025-03-26' });
    expect(calls[2]!.body.params).toEqual({ name: 'get_me', arguments: {} });
  });

  it('reads a text/event-stream reply, skipping notifications', async () => {
    const { doFetch } = fake({ get_transcript: () => textResult(TRANSCRIPT_TEXT) }, { sse: true });
    const r = await slateTool(C, 'get_transcript', { video: LINK }, doFetch);

    expect(r.ok && parseTranscript(r.data.text)).toHaveLength(3);
  });

  it('says a refused token may have expired (401), and never repeats the token', async () => {
    const { doFetch } = fake({}, { initialize: { status: 401, body: '{"error":{"code":"unauthorized","message":"Sign in to use the Slate MCP server."}}' } });
    const r = await slateTool(C, 'get_video', { video: LINK }, doFetch);

    expect(r).toMatchObject({ ok: false, status: 401, retryable: false });
    expect(!r.ok && r.message).toMatch(/may have expired.*Connections page.*Sign in to use the Slate MCP server/);
    expect(!r.ok && r.message).not.toContain(C.token);
  });

  it('says a plan is needed (402), and that a 503 is worth retrying', async () => {
    const paid = fake({ get_video: () => ({ http: { status: 402, body: '{"error":{"message":"A paid seat is needed."}}' } }) });

    expect(await slateTool(C, 'get_video', { video: LINK }, paid.doFetch)).toMatchObject({ ok: false, status: 402, retryable: false, message: expect.stringMatching(/paid plan.*A paid seat is needed/) });

    const down = fake({ get_video: () => ({ http: { status: 503, body: 'upstream down' } }) });

    expect(await slateTool(C, 'get_video', { video: LINK }, down.doFetch)).toMatchObject({ ok: false, status: 503, retryable: true });
  });

  it('turns a tool error into a sentence with Slate\'s words', async () => {
    const { doFetch } = fake({ get_video: () => ({ isError: true, content: [{ type: 'text', text: '"x" is not a recording. Give a share link (https://.../v/abc123), the share id out of one, or the recording\'s id.' }] }) });
    const r = await slateTool(C, 'get_video', { video: 'x' }, doFetch);

    expect(r).toMatchObject({ ok: false, status: 404, retryable: false, message: expect.stringMatching(/^Slate found nothing to read the recording\. Slate said: ""x" is not a recording/) });
  });

  it('says so when the network fails', async () => {
    const doFetch: SlateFetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };

    expect(await slateTool(C, 'get_me', {}, doFetch)).toMatchObject({ ok: false, status: null, retryable: true, message: expect.stringMatching(/could not be reached.*ENOTFOUND/) });
  });
});

describe('the parsers', () => {
  it('reads moments in every way Slate writes them', () => {
    expect([parseMoment(83), parseMoment('83'), parseMoment('1:23'), parseMoment('01:02:03'), parseMoment('1m23s'), parseMoment('abc')]).toEqual([83, 83, 83, 3723, 83, null]);
  });

  it('reads the transcript lines and drops the header and the empty-window note', () => {
    expect(parseTranscript(TRANSCRIPT_TEXT)).toEqual([
      { at: 0, text: 'So this portal has no API.' },
      { at: 7, text: 'I sign in and open the invoices.' },
      { at: 3723, text: 'And that is the last one.' },
    ]);
    expect(parseTranscript('"T", 0:34 long, language en-US, 0 line(s) around "x"\n\n(nothing in that range)')).toEqual([]);
  });

  it('reads activity as JSON, an empty log as empty, and a line form too', () => {
    expect(parseActivity(ACTIVITY_TEXT)).toEqual([{ at: 1.03, app: 'Google Chrome', title: 'Northwind Portal', url: 'https://portal.northwind.example/' }]);
    expect(parseActivity(NO_ACTIVITY_TEXT)).toEqual([]);
    expect(parseActivity('[0:12] Google Chrome — Northwind Portal (https://portal.northwind.example/)')).toEqual([{ at: 12, app: 'Google Chrome', title: 'Northwind Portal', url: 'https://portal.northwind.example/' }]);
  });

  it('reads the video facts, with the pages that were on screen', () => {
    expect(parseVideo(VIDEO_TEXT)).toEqual({
      id: '01a00000-0000-7000-8000-000000000001',
      url: LINK,
      title: 'Northwind invoice portal walkthrough',
      summary: 'Reading invoices from a portal with no API.',
      durationSec: 34.901667,
      recordedBy: 'Dana Kestrel',
      pages: [{ at: 1.03, title: 'Northwind Portal', url: 'https://portal.northwind.example/' }],
      hasTranscript: true,
      raw: VIDEO_TEXT,
    });
    expect(parseVideo('not json', LINK)).toMatchObject({ id: null, url: LINK, title: null, pages: [], hasTranscript: false, raw: 'not json' });
  });
});

describe('reading a recording', () => {
  it('reads facts, transcript and activity on one session', async () => {
    const { doFetch, calls } = fake({
      get_video: () => textResult(VIDEO_TEXT),
      get_transcript: () => textResult(TRANSCRIPT_TEXT),
      get_activity: () => textResult(ACTIVITY_TEXT),
    });
    const r = await readSlateRecording(C, LINK, doFetch);

    expect(r.ok).toBe(true);
    expect(r.ok && r.data.video.title).toBe('Northwind invoice portal walkthrough');
    expect(r.ok && r.data.transcript).toHaveLength(3);
    expect(r.ok && r.data.activity).toEqual([{ at: 1.03, app: 'Google Chrome', title: 'Northwind Portal', url: 'https://portal.northwind.example/' }]);
    expect(calls.filter(c => c.body.method === 'initialize')).toHaveLength(1);
    expect(calls.filter(c => c.body.method === 'tools/call').map(c => c.body.params?.arguments)).toEqual([{ video: LINK }, { video: LINK }, { video: LINK }]);
  });

  it('treats no activity log, or activity Slate will not serve, as empty rather than a failure', async () => {
    const none = fake({ get_video: () => textResult(VIDEO_TEXT), get_transcript: () => textResult(TRANSCRIPT_TEXT), get_activity: () => textResult(NO_ACTIVITY_TEXT) });

    expect(await readSlateRecording(C, LINK, none.doFetch)).toMatchObject({ ok: true, data: { activity: [] } });

    const unsupported = fake({ get_video: () => textResult(VIDEO_TEXT), get_transcript: () => textResult(TRANSCRIPT_TEXT), get_activity: () => ({ isError: true, content: [{ type: 'text', text: 'Activity is only kept for Mac app recordings.' }] }) });

    expect(await readSlateRecording(C, LINK, unsupported.doFetch)).toMatchObject({ ok: true, data: { activity: [] } });
  });

  it('fails with the reason when the recording cannot be read', async () => {
    const { doFetch } = fake({ get_video: () => ({ http: { status: 401, body: '' } }) });

    expect(await readSlateRecording(C, LINK, doFetch)).toMatchObject({ ok: false, status: 401 });
  });
});

describe('frames', () => {
  const png = (at: number) => [
    { type: 'text', text: `Frame at 0:${String(Math.floor(at)).padStart(2, '0')} (${at.toFixed(1)}s). https://frames.video-host.example/${at * 10}.jpg` },
    { type: 'image', data: `b64-${at}`, mimeType: 'image/jpeg' },
  ];
  const screenshots = (args: Record<string, unknown>) => {
    const at = Number(args.at);
    const count = Number(args.count ?? 1);
    const every = Number(args.every ?? 5);
    return { content: Array.from({ length: count }, (_, k) => png(at + every * k)).flat() };
  };

  it('asks for evenly spaced moments as runs of at most eight, the rest in pairs or alone, in time order', async () => {
    const { doFetch, calls } = fake({ get_screenshot: screenshots });
    const moments = [...Array.from({ length: 10 }, (_, k) => k * 2), 33.3, 21, 21, 40];
    const r = await slateFrames(C, LINK, moments, doFetch);

    const asked = calls.filter(c => c.body.method === 'tools/call').map(c => c.body.params?.arguments);

    expect(asked).toEqual([
      { video: LINK, at: 0, count: 8, every: 2 },
      { video: LINK, at: 16, count: 2, every: 2 },
      { video: LINK, at: 21, count: 2, every: 12.3 },
      { video: LINK, at: 40 },
    ]);
    expect(calls.filter(c => c.body.method === 'initialize')).toHaveLength(1);
    expect(r.ok && r.data.map(f => f.at)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 21, 33.3, 40]);
    expect(r.ok && r.data[0]).toEqual({ at: 0, mime: 'image/jpeg', base64: 'b64-0' });
  });

  it('asks for nothing when no moments are given, and stops at the first refusal', async () => {
    const empty = fake({});

    expect(await slateFrames(C, LINK, [], empty.doFetch)).toEqual({ ok: true, data: [] });
    expect(empty.calls).toHaveLength(0);

    const refused = fake({ get_screenshot: () => ({ http: { status: 402, body: '' } }) });

    expect(await slateFrames(C, LINK, [1, 30], refused.doFetch)).toMatchObject({ ok: false, status: 402 });
  });
});

describe('the workspace credential', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/services/SourceCredentialService');
    vi.doUnmock('@/services/ApiTokenService');
    vi.resetModules();
  });

  it('reads the vaulted credential, and falls back to VOCION_SLATE_TOKEN for a local demo', async () => {
    let stored: Record<string, unknown> | undefined = { token: 'slt_vaulted_0001' };
    vi.doMock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: async () => stored }));
    vi.doMock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: async () => null }));
    vi.doMock('@/libs/DB', () => ({ db: { select: () => {
      throw new Error('no db in tests');
    } } }));
    const { slateCredentialsForOrg: forOrg } = await import('./recording');

    expect(await forOrg('org-1')).toEqual({ ok: true, credentials: { token: 'slt_vaulted_0001', apiBase: 'https://api.slatevideo.com' } });

    stored = undefined;
    vi.stubEnv('VOCION_SLATE_TOKEN', 'slt_env_0001');
    vi.stubEnv('VOCION_SLATE_API_BASE', 'https://api.video-host.example');

    expect(await forOrg('org-1')).toEqual({ ok: true, credentials: { token: 'slt_env_0001', apiBase: 'https://api.video-host.example' } });

    vi.stubEnv('VOCION_SLATE_TOKEN', '');

    expect(await forOrg('org-1')).toMatchObject({ ok: false, message: expect.stringMatching(/No Slate token/) });
  });
});
