import { NextResponse } from 'next/server';
import { runnerTarget } from '@/libs/runners/config';
import { claimNextRun } from '@/services/runners/claimNext';
import { isInstallationRunnerToken } from '@/services/runners/runToken';
import { assertExternalWorkersEnabled } from '@/services/WorkerRunService';
import { isErrorResponse, jsonError, readJsonBody } from '../../_shared';
import { str, workerRunErrorResponse } from '../../worker-runs/_lib';

/**
 * POST /api/v1/runner/claim  { target, workerId, workerVersion?, claimAfterSeconds?, runId? }
 *
 * The installation's runners take the next engineering run from any workspace on it (backlog
 * 052). Auth: the installation runner token (`VOCION_RUNNER_TOKEN`), never a workspace's.
 * `target` must be one the installation declares (`libs/runners/config.ts`); `claimAfterSeconds`
 * is how long a run waits before this runner takes it (the on-box backup's `RUNNER_CLAIM_AFTER`),
 * and the target's own setting wins over it; `runId` claims only that run.
 *
 * 200 `{ run, leaseExpiresAt, toolClaim, runToken, git }`: `runToken` is the credential for every
 * call about this run, scoped to the workspace that queued it; `git` is the repository's push
 * credential when the workspace has one (`services/runners/repoCredential.ts`). 204 when there is
 * nothing for this target to take.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!isInstallationRunnerToken(bearer)) {
    return jsonError('UNAUTHORIZED', 'This route takes the installation runner token (VOCION_RUNNER_TOKEN)', 401);
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const workerId = str(body, 'workerId');
  const name = str(body, 'target');
  if (!workerId || !name) {
    return jsonError('VALIDATION_FAILED', 'workerId and target are required', 400);
  }
  const target = runnerTarget(name);
  if (!target) {
    return jsonError('FORBIDDEN', `"${name}" is not a runner target this installation declares (VOCION_RUNNERS)`, 403);
  }
  const runId = typeof body.runId === 'number' && Number.isInteger(body.runId) && body.runId > 0 ? body.runId : null;
  const claimAfterSeconds = typeof body.claimAfterSeconds === 'number' && body.claimAfterSeconds >= 0 ? body.claimAfterSeconds : 0;
  try {
    assertExternalWorkersEnabled();
    const claimed = await claimNextRun({ target, workerId, workerVersion: str(body, 'workerVersion'), claimAfterSeconds, runId });
    if (!claimed) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json({ run: claimed.run, leaseExpiresAt: claimed.run.leaseExpiresAt, toolClaim: claimed.toolClaim, runToken: claimed.runToken, git: claimed.git });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
