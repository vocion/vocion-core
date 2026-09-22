import type { NextResponse } from 'next/server';
import type { AutomationActor } from '@/services/AutomationService';
import type { ApiCaller } from '@/services/writeApi';
import { AutomationNotFoundError, AutomationPauseStateError } from '@/services/AutomationService';
import { getProfile } from '@/services/UserProfileService';
import { isErrorResponse, jsonError, readJsonBody } from '../_shared';

/**
 * Shared by the pause and resume routes: who the record names, what the body
 * may carry, and how the service's refusals read over HTTP.
 *
 * The oRPC twins (`routers/Automations.ts`) exist for the dashboard. These
 * exist for the operator who is not in the dashboard — the one on 20
 * September with sixty runaway runs, a terminal, and a tenant token — and
 * for the MCP tools, which go through the same service path so the audit row
 * is the same whichever door was used.
 */

/**
 * The actor the `control` row names. A session names the person; a token
 * names itself (`token:<id>`), because a token has no person behind it in the
 * moment and the row should not pretend otherwise.
 * @param caller - The authenticated caller.
 */
export async function controlActor(caller: ApiCaller): Promise<AutomationActor> {
  if (caller.source === 'token') {
    return { id: caller.actorId, name: `API token ${caller.actorId.replace(/^token:/, '')}` };
  }
  const profile = await getProfile(caller.actorId);
  return { id: caller.actorId, name: profile?.name?.trim() || profile?.email || null };
}

/**
 * `{ note }` from the body. A pause must say why — an emergency stop with no
 * reason is the row nobody can act on a week later — so `requireNote` makes an
 * empty or missing note a 400. An empty body is allowed where the note is not.
 * @param req - The request.
 * @param opts - Whether the note is required.
 * @param opts.requireNote
 */
export async function readControlNote(req: Request, opts: { requireNote: boolean }): Promise<string | null | NextResponse> {
  // No body at all is fine where the note is optional; `readJsonBody` would
  // call the empty stream invalid JSON.
  const empty = req.headers.get('content-length') === '0' || (req.headers.get('content-length') === null && !req.body);
  const body = empty ? {} : await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const raw = (body as Record<string, unknown>).note;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return jsonError('VALIDATION_FAILED', '`note` must be a string', 400);
  }
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (opts.requireNote && note === '') {
    return jsonError('VALIDATION_FAILED', 'A pause needs a `note` saying why — it is what the run log shows beside the gap', 400);
  }
  if (note.length > 500) {
    return jsonError('VALIDATION_FAILED', '`note` must be 500 characters or fewer', 400);
  }
  return note === '' ? null : note;
}

/**
 * The service's refusals as HTTP: an unknown slug is a 404, pausing a paused
 * automation (or resuming a running one) a 409 with the current state named.
 * Anything else is rethrown — a genuine fault should still surface as a 500.
 * @param error - Whatever the service threw.
 */
export function controlErrorResponse(error: unknown): NextResponse {
  if (error instanceof AutomationNotFoundError) {
    return jsonError('NOT_FOUND', error.message, 404);
  }
  if (error instanceof AutomationPauseStateError) {
    return jsonError('AUTOMATION_STATE', error.message, 409);
  }
  throw error;
}
