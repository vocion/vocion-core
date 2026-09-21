import { NextResponse } from 'next/server';
import { PAUSED_CAPABILITIES, readWorkspacePauseWithName } from '@/services/workspacePause';
import { authApi, isErrorResponse } from '../_shared';
import { pauseBody } from './_control';

/**
 * GET /api/v1/workspace — what this workspace is, and whether it is running.
 *
 * `paused` is the whole reason this endpoint exists: the off switch has to be
 * readable by whatever is about to ask the workspace to do something, so a
 * worker or an outside caller can say "the factory is stopped" instead of
 * discovering it one refusal at a time. It is `null` when the workspace is
 * running, and `{ by, at, note }` when someone has pulled the switch.
 *
 * `refuses` names what a pause holds and `allows` what it does not, so the
 * list a client shows never drifts from the list the guard enforces.
 *
 * Auth: tenant API token or dashboard session. Any authenticated caller may
 * read this — it is a fact about the workspace they are already in.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const pause = await readWorkspacePauseWithName(caller.orgId);
  return NextResponse.json({
    orgId: caller.orgId,
    paused: pauseBody(pause),
    refuses: Object.values(PAUSED_CAPABILITIES),
    allows: [
      'chat with an agent (a turn that tries one of the above is refused with the pause note)',
      'a worker run already holding a lease — it finishes and reports',
      'marking a hand-off action done, which a person performs by hand',
    ],
  });
}
