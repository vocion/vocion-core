import { NextResponse } from 'next/server';
import { getSurface, listSurfaces } from '@/libs/surfaces/registry';
import { postAnnouncementToChannel } from '@/services/ChatSurfaceService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../_shared';

/**
 * POST /api/v1/chat-announcements
 *   { surface, channelId, text, teamId?, threadTs?, images?, announcedLabel?, announcedUrl? }
 *
 * Post an announcement — release notes, a report — into a channel this org has
 * bound, carrying its screenshots.
 *
 * Posting THROUGH Vocion rather than straight at Slack is the point: the post
 * is recorded in `slack_post`, so when someone replies "any screenshots to go
 * with this?" the agent knows what "this" is without needing a history scope
 * on the Slack app. `announcedLabel` / `announcedUrl` are what it resolves to.
 *
 * Images are rendered inline — uploaded as files where the app holds
 * `files:write`, otherwise as Block Kit image blocks, which Slack fetches
 * itself. A link to an image does not unfurl in a private channel, so this
 * never falls back to pasting one.
 *
 * Auth: tenant API token or dashboard session. Authorises nothing in Slack —
 * the channel must already be bound to an agent in the caller's org.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const surfaceId = typeof body.surface === 'string' ? body.surface : 'slack';
  const adapter = getSurface(surfaceId);
  if (!adapter) {
    return jsonError('VALIDATION_FAILED', `surface must be one of ${listSurfaces().map(s => s.id).join('|')}`, 400);
  }
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!channelId || !text) {
    return jsonError('VALIDATION_FAILED', 'channelId and text are required', 400);
  }
  const images = Array.isArray(body.images)
    ? body.images
        .map(i => i as { url?: unknown; caption?: unknown })
        .filter(i => typeof i.url === 'string' && i.url)
        .map(i => ({ url: String(i.url), caption: typeof i.caption === 'string' ? i.caption : '' }))
        .slice(0, 10)
    : [];
  const result = await postAnnouncementToChannel(adapter, {
    orgId: caller.orgId,
    channelId,
    teamId: typeof body.teamId === 'string' && body.teamId.trim() ? body.teamId.trim() : null,
    text,
    images,
    announcedLabel: typeof body.announcedLabel === 'string' ? body.announcedLabel.trim() : null,
    announcedUrl: typeof body.announcedUrl === 'string' ? body.announcedUrl.trim() : null,
    threadTs: typeof body.threadTs === 'string' && body.threadTs.trim() ? body.threadTs.trim() : null,
    createdBy: caller.actorId,
  });
  if (result.outcome === 'unbound') {
    return jsonError('NOT_FOUND', 'that channel is not bound to an agent in this org — bind it with POST /api/v1/chat-bindings first', 404);
  }
  if (result.outcome === 'failed') {
    return jsonError('UPSTREAM_FAILED', result.error, 502);
  }
  return NextResponse.json({ ts: result.ts, media: result.media, recorded: result.recorded }, { status: 201 });
}
