import { clerkAuth as auth } from '@/libs/Auth';
/**
 * Resume a dropped agent stream — replay the events the client missed
 * (`?after=<count already received>`) and re-attach LIVE until the turn
 * finishes. 404 when the stream is unknown/expired (client then falls back
 * to conversation rehydrate, which already works).
 */
import { attachStream, hasStream } from '@/libs/streams/buffer';

const KEEPALIVE_INTERVAL_MS = 15_000;
/** How long a resume waits for the recovery to open the turn's stream again after a restart. */
const RECOVERY_WAIT_MS = 30_000;

/**
 * A turn that finished while the client was away, as one short stream: the
 * client clears what it had of the attempt it watched, gets the whole answer,
 * and the ending the row carries.
 * @param turn - The finished turn's row.
 * @param turn.content
 * @param turn.status
 */
function replayFinishedTurn(turn: { content: string; status: string | null }): Response {
  const quiet = new Set(['complete', 'stopped', 'truncated', 'continued']);
  const events: unknown[] = [
    { type: 'turn_restarted', reason: 'the app restarted while answering; this is the answer it finished with' },
    ...(turn.content ? [{ type: 'response_delta', delta: turn.content }] : []),
    ...(turn.status && !quiet.has(turn.status) ? [{ type: 'error', message: `the turn ended ${turn.status}`, ending: turn.status }] : []),
    { type: 'done', response: turn.content },
  ];
  const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new TextEncoder().encode(body), {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0;
  // Unknown, expired and somebody else's all answer the same 404. The check
  // is owner-scoped for exactly that reason: a 200 for a stream that exists
  // but is not yours would confirm the id, which is the guess this whole
  // ownership check exists to refuse.
  if (!id) {
    return new Response(JSON.stringify({ error: 'stream expired' }), { status: 404 });
  }
  // A TURN SURVIVES A RESTART (backlog 056). A stream this process does not
  // know may be a turn the previous process was answering: its ledger row says
  // so. Finished since, the row itself is replayed; still running, the
  // recovery is answering it again under this very id, so wait for its stream
  // and attach. Only a turn no ledger knows is a 404.
  if (!hasStream(id, { orgId, userId })) {
    const { turnByStreamId } = await import('@/services/chat/turnLedger');
    const turn = await turnByStreamId(orgId, userId, id).catch(() => null);
    if (!turn) {
      return new Response(JSON.stringify({ error: 'stream expired' }), { status: 404 });
    }
    if (turn.status !== 'running') {
      return replayFinishedTurn(turn);
    }
    const until = Date.now() + RECOVERY_WAIT_MS;
    while (!hasStream(id, { orgId, userId }) && Date.now() < until) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!hasStream(id, { orgId, userId })) {
      return new Response(JSON.stringify({ error: 'stream expired' }), { status: 404 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (!closed) {
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        }
      };
      const keepalive = setInterval(() => safeEnqueue(encoder.encode(': keepalive\n\n')), KEEPALIVE_INTERVAL_MS);
      const finish = () => {
        clearInterval(keepalive);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch { /* already closed */ }
        }
      };
      const detach = attachStream(
        id,
        { orgId, userId },
        after,
        data => safeEnqueue(encoder.encode(`data: ${data}\n\n`)),
        finish,
      );
      if (!detach) {
        finish();
        return;
      }
      request.signal.addEventListener('abort', () => {
        detach();
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
