/**
 * Reading a Slate recording — what a Routine analyst needs to turn a narrated
 * screen recording into a spec: the video's facts, what was said and when,
 * which app or page had focus when, and still frames at chosen moments.
 *
 * Slate serves all of it from its MCP server at `${apiBase}/mcp` (Streamable
 * HTTP, JSON-RPC 2.0), which takes the same `slt_…` session token (or a team
 * key, `slk_…`) the connector vaults. The protocol here is the minimal one —
 * `initialize`, `notifications/initialized`, `tools/call` — rather than the
 * SDK client in `libs/outboundMcp`, so the network stays a {@link SlateFetch}
 * a test can stand in for and every failure stays a sentence, never a throw.
 *
 * The shapes the tools answer with (read off Slate's MCP, 2026-10-22):
 *
 *   get_video       one text block of pretty JSON: id, shareId, url, title,
 *                   summary, durationSec, owner {name,email}, transcript
 *                   ("ready"), links [{url,title,at,atLabel}] — the pages that
 *                   were on screen — chapters, appsOnScreen, …
 *   get_transcript  a header line (`"Title", 1:43 long, language en-US, 8 of 14
 *                   lines`), a blank line, then `[m:ss] text` lines; a window
 *                   or query with no lines answers `(nothing in that range)`
 *   get_activity    JSON `{ moments: [{at, atLabel, app, title, url}], links }`,
 *                   or `{ moments: [], note }` when the recorder logged nothing
 *                   (anything not made with the Mac app)
 *   get_screenshot  per frame, a text block (`Frame at 0:20 (20.0s), on screen:
 *                   App — Title (url). <frame url>`) then an image block
 *   errors          `isError` with a sentence ("… is not a recording. …"); a
 *                   refused token is HTTP 401 `{"error":{"code","message"}}`
 */

import type { SlateCredentials, SlateFailure, SlateFetch, SlateResult } from './client';
import { SLATE_API_BASE, slateCredentialsFrom } from './client';

const TIMEOUT_MS = 60_000;
const PROTOCOL_VERSION = '2025-06-18';
const FRAMES_PER_CALL = 8;

export type SlateRecording = {
  video: {
    id: string | null;
    url: string;
    title: string | null;
    summary: string | null;
    durationSec: number | null;
    recordedBy: string | null;
    /** The web pages that came up on screen, with the moment each did. */
    pages: Array<{ at: number; title: string | null; url: string | null }>;
    hasTranscript: boolean;
    /** get_video's own text, for whatever the fields above leave out (chapters, tags, apps). */
    raw: string;
  };
  transcript: Array<{ at: number; text: string }>;
  /** Which app/window/page had focus from each moment. Empty for recordings not made with Slate's Mac app. */
  activity: Array<{ at: number; app: string | null; title: string | null; url: string | null }>;
};

export type SlateToolOutput = { text: string; images: Array<{ mime: string; base64: string }> };

export type SlateFrame = { at: number; mime: string; base64: string };

const defaultFetch: SlateFetch = (url, init) => fetch(url, init as RequestInit);

// ---------------------------------------------------------------------------
// Parsing

/**
 * A moment on the recording in seconds: 83, "83", "1:23", "01:02:03", "1m23s".
 * @param raw - The moment as written.
 */
export function parseMoment(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const s = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return Number(s);
  }
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (clock) {
    return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  const units = /^(?:(\d+)h)?\s*(?:(\d+)m\s*)?(?:(\d+(?:\.\d+)?)s)?$/i.exec(s);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const TIMESTAMPED = /^\s*\[(\d+(?::\d{1,2}){1,2}(?:\.\d+)?)\](.*)$/;

/**
 * get_transcript's `[m:ss] text` lines, in order. The header line and
 * `(nothing in that range)` are not lines of speech and are dropped.
 * @param text - The tool's text.
 */
export function parseTranscript(text: string): SlateRecording['transcript'] {
  const out: SlateRecording['transcript'] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TIMESTAMPED.exec(line);
    const at = m ? parseMoment(m[1]) : null;
    const said = m?.[2]?.trim();
    if (at !== null && said) {
      out.push({ at, text: said });
    }
  }
  return out;
}

/**
 * get_activity's moments. Slate answers JSON (`{ moments: [...] }`); a plain
 * `[m:ss] App — Title (url)` line form is read too, should it ever answer so.
 * An empty list is an answer (no recorder log), not a failure.
 * @param text - The tool's text.
 */
export function parseActivity(text: string): SlateRecording['activity'] {
  const j = jsonObject(text);
  const list = j
    ? j.moments
    : (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      })();
  if (Array.isArray(list)) {
    return list.flatMap((m) => {
      const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
      const at = parseMoment(o.at ?? o.atLabel);
      return at === null ? [] : [{ at, app: str(o.app), title: str(o.title), url: str(o.url) }];
    });
  }
  if (j) {
    return [];
  }
  const out: SlateRecording['activity'] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TIMESTAMPED.exec(line);
    const at = m ? parseMoment(m[1]) : null;
    if (at === null || !m?.[2]) {
      continue;
    }
    let rest = m[2].trim();
    const url = /\((https?:\/\/[^\s)]+)\)\s*\.?$/.exec(rest);
    if (url) {
      rest = rest.slice(0, url.index).trim();
    }
    const [app, ...title] = rest.split(/\s+[—–-]\s+/);
    out.push({ at, app: str(app), title: str(title.join(' — ')), url: url?.[1] ?? null });
  }
  return out;
}

/**
 * get_video's JSON, as the fields a spec needs. Text that is not JSON still
 * comes back (`raw`), its facts unknown.
 * @param text - The tool's text.
 * @param asked - The link or id the caller gave, the url when Slate names none.
 */
export function parseVideo(text: string, asked = ''): SlateRecording['video'] {
  const j = jsonObject(text) ?? {};
  const owner = (j.owner && typeof j.owner === 'object' ? j.owner : {}) as Record<string, unknown>;
  const links = Array.isArray(j.links) ? j.links : [];
  const transcript = j.transcript;
  return {
    id: str(j.id) ?? str(j.shareId),
    url: str(j.url) ?? asked,
    title: str(j.title),
    summary: str(j.summary),
    durationSec: num(j.durationSec),
    recordedBy: str(owner.name) ?? str(j.submitterName) ?? str(owner.email) ?? (typeof j.owner === 'string' ? str(j.owner) : null),
    pages: links.flatMap((l) => {
      const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const at = parseMoment(o.at ?? o.atLabel);
      return at === null ? [] : [{ at, title: str(o.title), url: str(o.url) }];
    }),
    hasTranscript: transcript === 'ready' || transcript === true,
    raw: text,
  };
}

// ---------------------------------------------------------------------------
// The protocol

type RpcMessage = { jsonrpc?: string; id?: number | string | null; result?: unknown; error?: { code?: number; message?: string } };

function sseMessages(body: string): unknown[] {
  const out: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data.trim()) {
      continue;
    }
    try {
      out.push(JSON.parse(data));
    } catch { /* a keep-alive or a partial event */ }
  }
  return out;
}

function detailOf(body: string): string {
  let detail = body;
  const j = jsonObject(body);
  if (j) {
    const err = j.error;
    detail = typeof j.message === 'string'
      ? j.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : '';
  }
  return detail.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * A refusal in the sentence style of `client.ts`, with whether trying again
 * could help.
 * @param status - The HTTP status (or the one a tool error's words imply).
 * @param what - What the call was doing ("read the transcript").
 * @param detail - Slate's own words, when any.
 */
function refusal(status: number, what: string, detail: string): SlateFailure {
  const said = detail ? ` Slate said: "${detail}"` : '';
  if (status === 401) {
    return { ok: false, status, retryable: false, message: `Slate refused the token while trying to ${what}; it may have expired (session tokens last about 90 days). Paste a new one on the Connections page.${said}` };
  }
  if (status === 402) {
    return { ok: false, status, retryable: false, message: `Slate needs a paid plan (a paid seat for this account) to ${what}.${said}` };
  }
  if (status === 403) {
    return { ok: false, status, retryable: false, message: `Slate would not let this account ${what}; the recording may belong to another team.${said}` };
  }
  if (status === 404) {
    return { ok: false, status, retryable: false, message: `Slate found nothing to ${what}.${said}` };
  }
  return { ok: false, status, retryable: status === 429 || status >= 500, message: `Slate answered ${status} while trying to ${what}.${said}` };
}

function unreachable(err: unknown, what: string): SlateFailure {
  const aborted = (err as Error)?.name === 'AbortError';
  return { ok: false, status: null, retryable: true, message: aborted ? `Slate did not answer within ${TIMEOUT_MS / 1000}s while trying to ${what}.` : `Slate could not be reached to ${what} (${(err as Error)?.message?.slice(0, 160) ?? 'network error'}).` };
}

/** A tool's answer, with its images paired to the moments their captions name. */
type ToolAnswer = SlateToolOutput & { frames: Array<{ at: number | null; mime: string; base64: string }> };

type Session = {
  call: (name: string, args: Record<string, unknown>, what: string) => Promise<SlateResult<ToolAnswer>>;
};

/**
 * One MCP session against Slate: the handshake, then as many tool calls as
 * the caller makes on it.
 * @param c - Where and as whom.
 * @param doFetch - The network.
 */
async function openSession(c: SlateCredentials, doFetch: SlateFetch): Promise<SlateResult<Session>> {
  const endpoint = `${c.apiBase}/mcp`;
  let sessionId: string | null = null;
  let protocol: string | null = null;
  let nextId = 1;

  const post = async (message: Record<string, unknown>, what: string): Promise<SlateResult<RpcMessage | null>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.token}`,
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
          ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', ...message }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let body = '';
        try {
          body = await res.text();
        } catch { /* no body */ }
        return refusal(res.status, what, detailOf(body));
      }
      sessionId = res.headers.get('mcp-session-id') ?? sessionId;
      if (!('id' in message)) {
        return { ok: true, data: null };
      }
      const body = await res.text();
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      const isStream = type.includes('text/event-stream') || (!type.includes('json') && /^data:/m.test(body));
      const messages: unknown[] = isStream
        ? sseMessages(body)
        : (() => {
            try {
              const v = JSON.parse(body) as unknown;
              return Array.isArray(v) ? v : [v];
            } catch {
              return [];
            }
          })();
      const reply = messages.find((m): m is RpcMessage => !!m && typeof m === 'object' && (m as RpcMessage).id === message.id);
      if (!reply) {
        return { ok: false, status: res.status, retryable: true, message: `Slate sent no answer while trying to ${what}.` };
      }
      return { ok: true, data: reply };
    } catch (err) {
      return unreachable(err, what);
    } finally {
      clearTimeout(timer);
    }
  };

  const init = await post({
    id: nextId++,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'vocion', version: '1.0.0' } },
  }, 'open a session');
  if (!init.ok) {
    return init;
  }
  if (init.data?.error) {
    return { ok: false, status: null, retryable: false, message: `Slate would not open a session: ${detailOf(JSON.stringify(init.data.error)) || 'no reason given'}.` };
  }
  const negotiated = (init.data?.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  protocol = typeof negotiated === 'string' ? negotiated : PROTOCOL_VERSION;
  const ack = await post({ method: 'notifications/initialized' }, 'open a session');
  if (!ack.ok) {
    return ack;
  }

  return {
    ok: true,
    data: {
      async call(name, args, what) {
        const r = await post({ id: nextId++, method: 'tools/call', params: { name, arguments: args } }, what);
        if (!r.ok) {
          return r;
        }
        if (r.data?.error) {
          const detail = detailOf(JSON.stringify(r.data.error));
          return { ok: false, status: null, retryable: false, message: `Slate could not ${what}.${detail ? ` Slate said: "${detail}"` : ''}` };
        }
        const result = (r.data?.result ?? {}) as { content?: unknown; isError?: boolean };
        const content = Array.isArray(result.content) ? result.content as Array<Record<string, unknown>> : [];
        const text = content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n');
        if (result.isError) {
          const detail = text.replace(/\s+/g, ' ').trim().slice(0, 240);
          // Tool errors carry no status; the words say which kind it was.
          const status = /paid (?:seat|plan)|upgrade|subscription/i.test(detail)
            ? 402
            : /sign in|expired|unauthori[sz]ed/i.test(detail)
              ? 401
              : /not a recording|not found|no such|no recording/i.test(detail) ? 404 : 400;
          return refusal(status, what, detail);
        }
        const frames = framesOf(content);
        return { ok: true, data: { text, images: frames.map(f => ({ mime: f.mime, base64: f.base64 })), frames } };
      },
    },
  };
}

/**
 * Pairs each image block with the moment its preceding `Frame at … (20.0s)`
 * text names, when it names one.
 * @param content - The tool result's content blocks.
 */
function framesOf(content: Array<Record<string, unknown>>): Array<{ at: number | null; mime: string; base64: string }> {
  const out: Array<{ at: number | null; mime: string; base64: string }> = [];
  let at: number | null = null;
  for (const b of content) {
    if (b.type === 'text' && typeof b.text === 'string') {
      const m = /Frame at [^(]*\((\d+(?:\.\d+)?)s\)/i.exec(b.text) ?? /Frame at (\d+(?::\d{1,2}){1,2})/i.exec(b.text);
      at = m ? parseMoment(m[1]) : at;
    } else if (b.type === 'image' && typeof b.data === 'string') {
      out.push({ at, mime: typeof b.mimeType === 'string' ? b.mimeType : 'image/jpeg', base64: b.data });
      at = null;
    }
  }
  return out;
}

const WHAT: Record<string, string> = {
  get_video: 'read the recording',
  get_transcript: 'read the transcript',
  get_activity: 'read what was on screen',
  get_screenshot: 'take a frame from the recording',
  get_me: 'read the account',
};

// ---------------------------------------------------------------------------
// The reads

/**
 * One Slate MCP tool call, in a session of its own.
 * @param c - Where and as whom.
 * @param name - The tool (`get_video`, `get_transcript`, …).
 * @param args - Its arguments.
 * @param doFetch - The network.
 */
export async function slateTool(c: SlateCredentials, name: string, args: Record<string, unknown>, doFetch: SlateFetch = defaultFetch): Promise<SlateResult<SlateToolOutput>> {
  const session = await openSession(c, doFetch);
  if (!session.ok) {
    return session;
  }
  const r = await session.data.call(name, args, WHAT[name] ?? `run ${name}`);
  return r.ok ? { ok: true, data: { text: r.data.text, images: r.data.images } } : r;
}

/**
 * The recording's facts, transcript and on-screen activity, in one session.
 * A recording with no activity log (anything not made with Slate's Mac app)
 * answers an empty `activity`, as does one whose activity Slate will not
 * serve — neither stops the read. A missing transcript is likewise empty.
 * @param c - Where and as whom.
 * @param video - A share link (https://slate.metacto.com/v/<id>), share id or library id.
 * @param doFetch - The network.
 */
export async function readSlateRecording(c: SlateCredentials, video: string, doFetch: SlateFetch = defaultFetch): Promise<SlateResult<SlateRecording>> {
  const session = await openSession(c, doFetch);
  if (!session.ok) {
    return session;
  }
  const s = session.data;
  const info = await s.call('get_video', { video }, WHAT.get_video!);
  if (!info.ok) {
    return info;
  }
  const facts = parseVideo(info.data.text, video);
  const [said, seen] = await Promise.all([
    facts.hasTranscript || !jsonObject(info.data.text) ? s.call('get_transcript', { video }, WHAT.get_transcript!) : Promise.resolve(null),
    s.call('get_activity', { video }, WHAT.get_activity!),
  ]);
  if (said && !said.ok && (said.status === 401 || said.status === 402 || said.status === null)) {
    return said;
  }
  return {
    ok: true,
    data: {
      video: facts,
      transcript: said?.ok ? parseTranscript(said.data.text) : [],
      activity: seen.ok ? parseActivity(seen.data.text) : [],
    },
  };
}

/**
 * Runs of evenly spaced moments, ≤8 each, so a spread of frames costs one call.
 * @param moments - Sorted, distinct moments.
 */
function runsOf(moments: number[]): Array<{ at: number; count: number; every: number }> {
  const runs: Array<{ at: number; count: number; every: number }> = [];
  let i = 0;
  while (i < moments.length) {
    const start = moments[i]!;
    const step = i + 1 < moments.length ? Math.round((moments[i + 1]! - start) * 10) / 10 : 0;
    let n = 1;
    if (step > 0) {
      while (n < FRAMES_PER_CALL && i + n < moments.length && Math.abs(moments[i + n]! - (start + step * n)) < 0.05) {
        n++;
      }
    }
    runs.push({ at: start, count: n, every: n > 1 ? step : 0 });
    i += n;
  }
  return runs;
}

/**
 * Still frames at the moments asked for, in time order. Evenly spaced moments
 * go up as one `at + count + every` call (≤8 frames each); the rest one call
 * per moment, all on one session.
 * @param c - Where and as whom.
 * @param video - A share link, share id or library id.
 * @param moments - Seconds on the finished recording.
 * @param doFetch - The network.
 */
export async function slateFrames(c: SlateCredentials, video: string, moments: number[], doFetch: SlateFetch = defaultFetch): Promise<SlateResult<SlateFrame[]>> {
  const wanted = [...new Set(moments.filter(m => Number.isFinite(m) && m >= 0).map(m => Math.round(m * 10) / 10))].sort((a, b) => a - b);
  if (wanted.length === 0) {
    return { ok: true, data: [] };
  }
  const session = await openSession(c, doFetch);
  if (!session.ok) {
    return session;
  }
  const frames: SlateFrame[] = [];
  for (const run of runsOf(wanted)) {
    const args = run.count > 1 ? { video, at: run.at, count: run.count, every: run.every } : { video, at: run.at };
    const r = await session.data.call('get_screenshot', args, WHAT.get_screenshot!);
    if (!r.ok) {
      return r;
    }
    r.data.frames.forEach((f, k) => frames.push({ at: f.at ?? run.at + run.every * k, mime: f.mime, base64: f.base64 }));
  }
  return { ok: true, data: frames };
}

// ---------------------------------------------------------------------------
// The workspace's credential

const SLATE_CONNECTOR_SLUG = 'slate';

async function slateSourceConfig(orgId: string): Promise<Record<string, unknown> | null> {
  try {
    const { and, eq, or, sql } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { knowledgeSourceSchema } = await import('@/models/Schema');
    const [row] = await db
      .select({ config: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema)
      .where(and(
        eq(knowledgeSourceSchema.orgId, orgId),
        or(eq(knowledgeSourceSchema.slug, SLATE_CONNECTOR_SLUG), eq(sql`${knowledgeSourceSchema.configJson} ->> '_connector'`, SLATE_CONNECTOR_SLUG)),
      ))
      .orderBy(knowledgeSourceSchema.id)
      .limit(1);
    return row?.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * The workspace's Slate credential, the way `services/sentry/access.ts` reads
 * Sentry's: the connected `slate` source's vaulted credential first, then the
 * workspace's one live `slate` platform credential. With neither stored,
 * `VOCION_SLATE_TOKEN` (and `VOCION_SLATE_API_BASE`) stand in, for local demos.
 * The token is never logged.
 * @param orgId - The workspace.
 * @param userId
 */
export async function slateCredentialsForOrg(orgId: string, userId?: string | null): Promise<{ ok: true; credentials: SlateCredentials } | { ok: false; message: string }> {
  let values: Record<string, unknown> | null = null;
  let problem: string | null = null;
  try {
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    values = (await getCredentialsForSource(orgId, SLATE_CONNECTOR_SLUG)) as Record<string, unknown> | undefined ?? null;
  } catch (err) {
    // A connected source whose credential was revoked says so.
    problem = (err as Error).message;
  }
  if (!values) {
    try {
      const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
      values = await resolvePlatformCredential(orgId, SLATE_CONNECTOR_SLUG);
    } catch (err) {
      problem = problem ?? (err as Error).message;
    }
  }
  if (values) {
    return slateCredentialsFrom(values, await slateSourceConfig(orgId));
  }
  const envToken = process.env.VOCION_SLATE_TOKEN?.trim();
  if (envToken) {
    return slateCredentialsFrom({ token: envToken }, { apiBase: process.env.VOCION_SLATE_API_BASE?.trim() || SLATE_API_BASE });
  }
  // The person's own sign-in to Slate's MCP server (Tools → MCP servers, `auth: person`): the access
  // token it holds is the same `slt_` bearer the API takes, for that person only.
  if (userId) {
    try {
      const { personMcpCredentials } = await import('@/services/outboundMcp/personSignIn');
      const mcpUrl = `${SLATE_API_BASE}/mcp`;
      const grant = await personMcpCredentials({ source: { orgId, slug: 'slate', name: 'Slate', url: mcpUrl }, userId });
      if (grant.ok) {
        return slateCredentialsFrom({ token: grant.credentials.token }, { apiBase: new URL(grant.credentials.baseUrl).origin });
      }
    } catch { /* no sign-in: say what to connect */ }
  }
  const parsed = slateCredentialsFrom(null);
  return { ok: false, message: `${problem ? `${problem} ` : ''}${parsed.ok ? '' : parsed.message}`.trim() };
}
