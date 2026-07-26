import { clerkAuth as auth } from '@/libs/Auth';
/**
 * Resume a dropped agent stream — replay the events the client missed
 * (`?after=<count already received>`) and re-attach LIVE until the turn
 * finishes. 404 when the stream is unknown/expired (client then falls back
 * to conversation rehydrate, which already works).
 */
import { attachStream, hasStream } from '@/libs/streams/buffer';

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(request: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0;
  if (!id || !hasStream(id)) {
    return new Response(JSON.stringify({ error: 'stream expired' }), { status: 404 });
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
