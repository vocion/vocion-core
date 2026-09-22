import { NextResponse } from 'next/server';
import { pauseWorkspace } from '@/services/workspacePause';
import { authApi, isErrorResponse, requireCapability } from '../../_shared';
import { pauseBody, readWorkspaceNote, workspaceControlActor, workspaceControlErrorResponse } from '../_control';

/**
 * POST /api/v1/workspace/pause  { note } — the whole factory's off switch.
 *
 * One call stops everything this workspace does by itself: every automation
 * fire (scheduled or event, recorded as a `skipped` run with reason
 * `workspace_paused`), every mission run, every worker run queued or claimed,
 * and every gated action that is not a hand-off. Chat with an agent stays
 * open — a person talking is not the factory working — and a worker already
 * holding a lease finishes and reports rather than being killed.
 *
 * It does NOT touch per-automation pauses. An automation someone paused last
 * week is still paused after a resume, because a workspace pause never wrote
 * to it. That is why this is a separate column rather than a bulk edit.
 *
 * The `note` is required: it is the line everyone else in the workspace reads
 * on every page until the switch is lifted, so "stopped, no reason given" is
 * not a state this allows.
 *
 * Needs an owner or PM (a tenant token carries its role; a `['*']` grant
 * passes too). Pausing a workspace that is already paused answers 409 with
 * the current state, so a second operator learns the first got there.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'pause_workspace');
  if (denied) {
    return denied;
  }
  const note = await readWorkspaceNote(req, { requireNote: true });
  if (isErrorResponse(note)) {
    return note;
  }
  try {
    const by = workspaceControlActor(caller);
    const pause = await pauseWorkspace(caller.orgId, { by, note: note as string });
    return NextResponse.json({ paused: pauseBody(pause) }, { status: 200 });
  } catch (error) {
    return workspaceControlErrorResponse(error);
  }
}
