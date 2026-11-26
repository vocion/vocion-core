import type { NextResponse } from 'next/server';
import type { WorkspacePauseActor } from '@/services/workspacePause';
import type { ApiCaller } from '@/services/writeApi';
import { WorkspaceNotFoundError, WorkspacePauseStateError } from '@/services/workspacePause';
import { isErrorResponse, jsonError, readJsonBody } from '../_shared';

/**
 * Shared by the workspace pause and resume routes: who the record names, what
 * the body may carry, and how the service's refusals read over HTTP.
 *
 * The same shape as `automations/_control.ts`, deliberately — one pause reads
 * like the other, whichever scope it is at.
 */

/**
 * The actor the `paused_by` column names — the id, and nothing else. The
 * service resolves the display name (a person's from the user row, a token's
 * from its id), so a token and a session read the same way whichever door
 * the pause came through.
 * @param caller - The authenticated caller.
 */
export function workspaceControlActor(caller: ApiCaller): WorkspacePauseActor {
  return { id: caller.actorId };
}

/**
 * `{ note }` from the body. A workspace pause must say why — it is the line
 * everybody else in the workspace reads on every page until it is lifted — so
 * `requireNote` makes an empty or missing note a 400.
 * @param req - The request.
 * @param opts - Whether the note is required.
 * @param opts.requireNote
 */
export async function readWorkspaceNote(req: Request, opts: { requireNote: boolean }): Promise<string | null | NextResponse> {
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
    return jsonError('VALIDATION_FAILED', 'A pause needs a `note` saying why — it is what the banner shows everyone else', 400);
  }
  if (note.length > 500) {
    return jsonError('VALIDATION_FAILED', '`note` must be 500 characters or fewer', 400);
  }
  return note === '' ? null : note;
}

/**
 * The service's refusals as HTTP: pausing a paused workspace (or resuming a
 * running one) is a 409, an org with no project row a 404. Anything else is
 * rethrown — a genuine fault should still surface as a 500.
 * @param error - Whatever the service threw.
 */
export function workspaceControlErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceNotFoundError) {
    return jsonError('NOT_FOUND', error.message, 404);
  }
  if (error instanceof WorkspacePauseStateError) {
    return jsonError('WORKSPACE_STATE', error.message, 409);
  }
  throw error;
}

/**
 * The hold as JSON — the same body the GET, the pause and the resume all answer with.
 * @param pause
 */
export function pauseBody(pause: { by: { id: string; name: string | null }; at: Date; note: string | null } | null) {
  return pause === null
    ? null
    : { by: pause.by, at: pause.at.toISOString(), note: pause.note };
}
