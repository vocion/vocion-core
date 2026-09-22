/**
 * "I have read enough" — the person pressed Stop on a running turn (#114).
 *
 * Stopping aborts the browser's fetch, and an aborted fetch is indistinguishable
 * from a locked phone or a refreshed tab. Those two must behave differently:
 * a dropped connection leaves the run going and the client reattaches through
 * `resume`, while a stop means the turn is over and the short answer stored
 * against it was the person's choice, not a fault. Nothing in the socket says
 * which happened, so the client says it here.
 *
 * Deliberately small: it marks the turn and nothing else. The run keeps going
 * to its natural end — killing it mid-tool-call would be a new way to leave
 * half-written work behind — and the SSE route reads the mark when it persists
 * the row, storing `stopped` instead of `complete`.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { markStopped } from '@/libs/streams/buffer';

export async function POST(request: Request): Promise<Response> {
  const { orgId, userId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const streamId = typeof body.stream_id === 'string' ? body.stream_id : '';
  if (!streamId) {
    return new Response(JSON.stringify({ error: 'stream_id is required' }), { status: 400 });
  }
  // A stop for a turn that already finished, or for a stream this process has
  // swept, is not an error — the person's intent simply arrived too late to
  // change anything. Say which happened so the client can stay quiet either way.
  const marked = markStopped(streamId);
  return new Response(JSON.stringify({ marked }), { headers: { 'Content-Type': 'application/json' } });
}
