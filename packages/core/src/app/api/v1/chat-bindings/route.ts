import { NextResponse } from 'next/server';
import { listSurfaces } from '@/libs/surfaces/registry';
import { createBinding, listBindings } from '@/services/ChatSurfaceService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../_shared';

/**
 * GET /api/v1/chat-bindings — which channels answer as which agent, for the caller's org.
 * Auth: tenant API token or dashboard session.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  return NextResponse.json({ bindings: await listBindings(caller.orgId), surfaces: listSurfaces().map(s => s.id) });
}

/**
 * POST /api/v1/chat-bindings  { surface, channelId, agentSlug, teamId?, displayName?, iconUrl? }
 * Bind a channel to an agent. `channelId: "*"` with a `teamId` is the workspace catch-all (DMs).
 * `displayName` + `iconUrl` are the optional persona the replies wear; omitting them posts
 * under the app's own name and icon.
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
  const surface = typeof body.surface === 'string' ? body.surface : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const agentSlug = typeof body.agentSlug === 'string' ? body.agentSlug.trim() : '';
  const teamId = typeof body.teamId === 'string' && body.teamId.trim() ? body.teamId.trim() : null;
  const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : null;
  const iconUrl = typeof body.iconUrl === 'string' && body.iconUrl.trim() ? body.iconUrl.trim() : null;
  if (!listSurfaces().some(s => s.id === surface)) {
    return jsonError('VALIDATION_FAILED', `surface must be one of ${listSurfaces().map(s => s.id).join('|')}`, 400);
  }
  if (!channelId || !agentSlug) {
    return jsonError('VALIDATION_FAILED', 'channelId and agentSlug are required', 400);
  }
  if (channelId === '*' && !teamId) {
    return jsonError('VALIDATION_FAILED', 'a "*" catch-all binding needs a teamId', 400);
  }
  // Slack fetches the avatar itself, from the public internet, on every message.
  if (iconUrl && !iconUrl.startsWith('https://')) {
    return jsonError('VALIDATION_FAILED', 'iconUrl must be an https URL', 400);
  }
  try {
    const binding = await createBinding({ orgId: caller.orgId, surface, teamId, channelId, agentSlug, displayName, iconUrl, createdBy: caller.actorId });
    return NextResponse.json({ binding }, { status: 201 });
  } catch (error) {
    if (/unique|duplicate/i.test(error instanceof Error ? error.message : '')) {
      return jsonError('CONFLICT', 'that channel is already bound', 409);
    }
    throw error;
  }
}
