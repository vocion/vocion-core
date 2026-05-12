/**
 * Google Drive `files.watch` webhook receiver — Phase 6.
 *
 * Drive POSTs notifications to this endpoint when a watched deck/doc
 * receives a comment. We don't trust the payload to be complete (Drive
 * notifications are heads-up signals); the worker re-fetches the
 * authoritative comment list when it claims the job.
 *
 * This route is intentionally minimal — enqueue + ack. The worker
 * does the work. Full Drive-side comment fetching + reply + resolve
 * is a follow-on (ports the rest of rev-ai's server/comment_worker.py).
 */

import { enqueue } from '@/services/FeedbackWorkerService';

export async function POST(request: Request): Promise<Response> {
  // Drive sends notification metadata as headers. The body is usually
  // empty for `files.watch` channels. We require the org to be passed
  // in the channel `token` (set when we register the watch).
  const channelId = request.headers.get('x-goog-channel-id') ?? '';
  const resourceId = request.headers.get('x-goog-resource-id') ?? '';
  const resourceState = request.headers.get('x-goog-resource-state') ?? '';
  const token = request.headers.get('x-goog-channel-token') ?? '';

  if (!channelId || !resourceId || !token) {
    // Acknowledge anyway — Drive treats non-2xx as a reason to retry,
    // which we don't want for malformed payloads.
    return new Response(null, { status: 200 });
  }

  // The channel token is `orgId:<orgId>` when we registered the watch.
  // Defensive parsing: if it doesn't match, drop the notification.
  const match = token.match(/^orgId:(.+)$/);
  if (!match) {
    return new Response(null, { status: 200 });
  }
  const orgId = match[1]!;

  // Sync events (`sync` resource_state) are the channel-creation
  // confirmation; nothing to enqueue.
  if (resourceState === 'sync') {
    return new Response(null, { status: 200 });
  }

  await enqueue({
    orgId,
    source: 'drive',
    // (resourceId, channelId, resourceState) is roughly unique per
    // distinct comment event. The worker re-fetches the actual
    // comment(s) on this file before classifying.
    externalId: `${resourceId}:${channelId}:${resourceState}`,
    payload: {
      text: '',
      // The worker will fetch real comments via the Drive API; we
      // pass-through the file id so it knows what to look up.
      // (For now: stub — actual fetch ports from rev-ai
      // comment_worker.process_file_comments in a follow-up.)
      fileId: resourceId,
      channelId,
      resourceState,
    } as unknown as { text: string },
  });

  return new Response(null, { status: 200 });
}
