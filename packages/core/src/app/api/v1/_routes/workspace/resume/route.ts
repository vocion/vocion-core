import { NextResponse } from 'next/server';
import { resumeWorkspace } from '@/services/workspacePause';
import { authApi, isErrorResponse, requireCapability } from '../../_shared';
import { pauseBody, workspaceControlActor, workspaceControlErrorResponse } from '../_control';

/**
 * POST /api/v1/workspace/resume — lift the workspace pause.
 *
 * Everything comes back exactly as it was: schedules fire on their next tick,
 * event automations match again, worker runs may be claimed, gated actions
 * execute. Every automation a person paused individually is still paused,
 * untouched — nothing was saved on the way in, so nothing can be lost on the
 * way out.
 *
 * `lifted` names whose hold this was and what their note said, because the
 * person resuming is usually not the person who stopped it.
 *
 * Needs an owner or PM. Resuming a workspace that is not paused answers 409.
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
  try {
    const by = workspaceControlActor(caller);
    const { lifted } = await resumeWorkspace(caller.orgId, { by });
    return NextResponse.json({ paused: null, lifted: pauseBody(lifted) }, { status: 200 });
  } catch (error) {
    return workspaceControlErrorResponse(error);
  }
}
