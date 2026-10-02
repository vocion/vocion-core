import type { LiveNotice } from '@/libs/live/topics';
import { liveHub } from '@/libs/live/hub';
import { MAX_LIVE_TOPICS } from '@/libs/live/topics';
import { authorizeTopics } from '@/services/live/authorizeTopics';
import { authApi, isErrorResponse, jsonError } from '../_shared';

export const dynamic = 'force-dynamic';

/** A comment line every 15s, so proxies and phones keep an idle stream open. */
const KEEPALIVE_MS = 15_000;
/** How long a browser waits before reconnecting a dropped stream. */
const RETRY_MS = 3_000;

/**
 * GET /api/v1/live
 *
 * The workspace live stream (backlog 050): Server-Sent Events carrying a
 * small change notice — `{id, topics, ref, kind, at}` — whenever something
 * the caller follows changes, wherever it was written (this app, another
 * container, the worker). A notice never carries the change itself: re-read
 * the thing through its own read (`/objects/:id/status`, a card's status, an
 * artifact), so shape and permission live in one place.
 *
 * Topics: `record:<id>`, `list:<type slug>`, `card:<id>`, `run:<id>`,
 * `mission:<id>`, `ask:<id>`, `artifact:<id>`, `notification:<userId>`, and
 * the workspace feeds `cards`, `runs`, `asks`, `events`
 * (`libs/live/topics.ts`). Each one is checked: a thing outside this
 * workspace, an artifact shared only with someone else, or another
 * person's notifications is refused and named in the first event.
 *
 * Events: `ready` first (`{topics, refused, transport}`), then one `notice`
 * per change with its ring id as the SSE id, a `reset` when the stream could
 * not replay what a reconnecting client missed (re-read everything shown),
 * and a comment every 15s. A reconnect resumes from `Last-Event-ID`; a first
 * connection may pass `since` so changes made while the page loaded arrive.
 * Auth: a signed-in session or a tenant API token (`Bearer vcn_live_…`).
 *
 * Query parameters:
 * - `topics` — comma-separated topics to follow (at most 400).
 * - `after` — resume after this notice id, when the `Last-Event-ID` header cannot be sent.
 * - `since` — epoch milliseconds; replay what changed since then (a first connection, up to two minutes back).
 * @param req - The request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const topics = (url.searchParams.get('topics') ?? '').split(',').map(t => t.trim()).filter(Boolean);
  if (topics.length === 0) {
    return jsonError('VALIDATION_FAILED', 'topics is required: a comma-separated list such as record:12,runs', 400);
  }
  if (topics.length > MAX_LIVE_TOPICS) {
    return jsonError('VALIDATION_FAILED', `at most ${MAX_LIVE_TOPICS} topics per stream; follow a feed (runs, cards, list:<type>) for more`, 400);
  }
  const { allowed, refused } = await authorizeTopics(caller, topics);
  if (allowed.length === 0) {
    return jsonError('FORBIDDEN', 'none of these topics may be followed here', 403, { refused });
  }

  const afterRaw = req.headers.get('last-event-id') ?? url.searchParams.get('after');
  const afterId = afterRaw && /^\d+$/.test(afterRaw) ? Number(afterRaw) : undefined;
  const sinceRaw = Number(url.searchParams.get('since'));
  const sinceMs = afterId === undefined && Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : undefined;

  const hub = liveHub();
  try {
    await hub.ready();
  } catch (err) {
    // Said, so the client polls and retries, rather than a bare 500.
    console.warn('[live] the stream could not start', { error: err instanceof Error ? err.message : String(err) });
    return jsonError('UNAVAILABLE', 'the live stream cannot read changes right now; poll, and try again shortly', 503);
  }
  const followed = new Set(allowed);
  const encoder = new TextEncoder();
  let end: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const sent = new Set<number>();
      const send = (n: LiveNotice) => {
        if (sent.has(n.id)) {
          return;
        }
        sent.add(n.id);
        if (sent.size > 4096) {
          sent.delete(sent.values().next().value as number);
        }
        write(`id: ${n.id}\nevent: notice\ndata: ${JSON.stringify(n)}\n\n`);
      };

      // Hold live notices until the replay is out, so they arrive in order.
      const held: LiveNotice[] = [];
      let replaying = true;
      const unsubscribe = hub.subscribe({
        orgId: caller.orgId,
        topics: followed,
        send: n => (replaying ? held.push(n) : send(n)),
      });
      const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
      const finish = () => {
        if (closed) {
          return;
        }
        clearInterval(keepalive);
        unsubscribe();
        closed = true;
        try {
          controller.close();
        } catch { /* already closed */ }
      };
      end = finish;
      req.signal.addEventListener('abort', finish);

      const state = hub.state();
      write(`retry: ${RETRY_MS}\n`);
      write(`event: ready\ndata: ${JSON.stringify({ topics: allowed, refused, transport: state.transport, pushing: state.pushing })}\n\n`);
      try {
        const replay = await hub.replay(caller.orgId, allowed, { afterId, sinceMs });
        if (replay.reset) {
          write(`event: reset\ndata: ${JSON.stringify({ reason: 'the stream no longer holds what this client missed; read again' })}\n\n`);
        }
        for (const n of replay.notices) {
          send(n);
        }
      } catch (err) {
        // A replay that failed is said, not skipped: the client reads again.
        console.warn('[live] replay failed', { error: err instanceof Error ? err.message : String(err) });
        write(`event: reset\ndata: ${JSON.stringify({ reason: 'could not replay what this client missed; read again' })}\n\n`);
      }
      replaying = false;
      for (const n of held.sort((a, b) => a.id - b.id)) {
        send(n);
      }
      held.length = 0;
    },
    cancel() {
      end?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
