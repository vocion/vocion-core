import { NextResponse } from 'next/server';
import { announcementContent, announceMode } from '@/services/factory/releaseAnnounce';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

/**
 * GET /api/v1/objects/[id]/announce
 *
 * A release's announcement as it would be published: the words, the live
 * screenshot it leads with (`image.url`, null when the release has none) and
 * where publishing sends it (`mode`: `slack` when the workspace has a Slack
 * connection, else `copy`).
 * @param req - The request.
 * @param ctx - Route params.
 * @param ctx.params - `{ id }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'release id');
  if (isErrorResponse(id)) {
    return id;
  }
  const found = await announcementContent(caller.orgId, id);
  if (!found.ok) {
    return jsonError('NOT_FOUND', found.error, 404);
  }
  const { content } = found;
  return NextResponse.json({
    releaseId: content.releaseId,
    title: content.title,
    text: content.text,
    image: content.image ? { artifactId: content.image.artifactId, url: content.image.url } : null,
    mode: await announceMode(caller.orgId),
  });
}

/**
 * POST /api/v1/objects/[id]/announce
 *
 * Publish a release's announcement, with its picture, to the workspace's
 * Slack channel — `release.announce`, proposed as the caller. A person's own
 * press runs at once (their action, with Undo on the run); a token's rides
 * the trust ladder and may come back `pending`. The words and the picture
 * are read off the release, never from the request. A failed post is
 * written on the release and returned as `error`.
 *
 * Returns `{ runId, status, line, error }`.
 * @param req - The request.
 * @param ctx - Route params.
 * @param ctx.params - `{ id }`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'release id');
  if (isErrorResponse(id)) {
    return id;
  }
  const found = await announcementContent(caller.orgId, id);
  if (!found.ok) {
    return jsonError('VALIDATION_FAILED', found.error, 400);
  }
  const { proposeAction, ActionError } = await import('@/services/ActionService');
  try {
    const res = await proposeAction({
      orgId: caller.orgId,
      actionId: 'release.announce',
      input: {
        releaseId: id,
        title: `Announce: ${found.content.title}`.slice(0, 200),
        summary: found.content.text.slice(0, 4_000),
        steps: [{ say: found.content.image ? 'Post the announcement to the workspace Slack channel with its picture.' : 'Post the announcement to the workspace Slack channel.' }],
      },
      principal: caller.principal,
      invokedBy: caller.actorId,
    });
    const line = typeof res.result?.line === 'string'
      ? res.result.line
      : res.status === 'pending' ? `Waiting on a person to publish it (action #${res.runId}).` : null;
    return NextResponse.json({ runId: res.runId, status: res.status, line, error: res.error ?? null }, { status: res.status === 'failed' ? 502 : 200 });
  } catch (err) {
    if (err instanceof ActionError) {
      return jsonError(err.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION_FAILED', err.message, err.code === 'FORBIDDEN' ? 403 : 400);
    }
    throw err;
  }
}
