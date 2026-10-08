import type { ClaimScope } from '@/services/runners/claimNext';
import { NextResponse } from 'next/server';
import { isMultiTenant } from '@/libs/multiTenant';
import { runnerTarget } from '@/libs/runners/config';
import { claimNextRun } from '@/services/runners/claimNext';
import { RUNNER_TOKEN_PREFIX, verifyRunnerToken } from '@/services/runners/runnerTokens';
import { isInstallationRunnerToken, RUN_TOKEN_PREFIX, verifyRunToken } from '@/services/runners/runToken';
import { assertExternalWorkersEnabled } from '@/services/WorkerRunService';
import { isErrorResponse, jsonError, readJsonBody } from '../../_shared';
import { str, workerRunErrorResponse } from '../../worker-runs/_lib';

type Credential
  = | { ok: true; scope: ClaimScope; pinned?: { runId: number; target: string } }
    | { ok: false; response: NextResponse };

/**
 * Which runs the bearer may claim. Three credentials claim, and nothing else does:
 *
 * - an account's runner token (`vcn_runner_…`): that account's runs, or the workspaces it lists;
 * - a start token (`vrt_…`, use `start`): the one run a target started this container for;
 * - the installation runner token (`VOCION_RUNNER_TOKEN`): every workspace, on a single-tenant
 *   installation only. A multi-tenant one (`VOCION_MULTI_TENANT=1`) refuses it, because a runner
 *   holding it builds one company's code with a key to every company's queue.
 *
 * A run token (use `run`) claims nothing: it is the credential for a run already claimed. Null
 * when the bearer is none of these at all.
 * @param bearer - The bearer value.
 */
async function credentialFor(bearer: string): Promise<Credential | null> {
  if (bearer.startsWith(RUNNER_TOKEN_PREFIX)) {
    const scope = await verifyRunnerToken(bearer);
    return scope
      ? { ok: true, scope: { kind: 'account', accountId: scope.accountId, projectIds: scope.projectIds } }
      : { ok: false, response: jsonError('UNAUTHORIZED', 'This runner token is not valid: it is unknown, revoked or expired.', 401) };
  }
  if (bearer.startsWith(RUN_TOKEN_PREFIX)) {
    const claim = verifyRunToken(bearer);
    if (!claim) {
      return { ok: false, response: jsonError('UNAUTHORIZED', 'This run token is not valid or has expired.', 401) };
    }
    if (claim.use !== 'start') {
      return { ok: false, response: jsonError('FORBIDDEN', 'A run token claims nothing: it is the credential for a run already claimed. Claim with a runner token.', 403) };
    }
    return { ok: true, scope: { kind: 'run', orgId: claim.orgId, runId: claim.runId }, pinned: { runId: claim.runId, target: claim.target } };
  }
  if (isInstallationRunnerToken(bearer)) {
    if (isMultiTenant()) {
      return { ok: false, response: jsonError('FORBIDDEN', 'This installation serves several accounts (VOCION_MULTI_TENANT=1), so the installation runner token claims nothing here. Claim with an account\'s runner token (Settings › Developers › Software Factory).', 403) };
    }
    return { ok: true, scope: { kind: 'installation' } };
  }
  return null;
}

/**
 * POST /api/v1/runner/claim  { target, workerId, workerVersion?, claimAfterSeconds?, runId? }
 *
 * A runner takes the next engineering run it may build (backlog 052; scoped per tenant in 5.1).
 * Auth: an account's runner token, a start token, or — single-tenant only — the installation
 * runner token (see `credentialFor`). `target` must be one the installation declares
 * (`libs/runners/config.ts`); a run whose workspace names a target goes only to that one.
 * `claimAfterSeconds` is how long a run waits before this runner takes it (the on-box backup's
 * `RUNNER_CLAIM_AFTER`), and the target's own setting wins over it; `runId` claims only that run.
 * A start token claims only its own run, as the target it was minted for.
 *
 * 200 `{ run, leaseExpiresAt, runToken, git }`: `runToken` is the credential for every call about
 * this run, bound to it and to this runner's lease; `git` is the repository's push credential when
 * the workspace has one (`services/runners/repoCredential.ts`). No `toolClaim` (5.1): a runner
 * calls no agent tool, and that claim acts across the workspace. 204 when there is nothing for
 * this credential and target to take.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const credential = await credentialFor(bearer);
  if (!credential) {
    return jsonError('UNAUTHORIZED', 'This route takes a runner token (vcn_runner_…), a start token, or the installation runner token (VOCION_RUNNER_TOKEN)', 401);
  }
  if (!credential.ok) {
    return credential.response;
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
  const asked = typeof body.runId === 'number' && Number.isInteger(body.runId) && body.runId > 0 ? body.runId : null;
  const { pinned } = credential;
  if (pinned && (pinned.target !== target.name || (asked !== null && asked !== pinned.runId))) {
    return jsonError('FORBIDDEN', `This start token claims run ${pinned.runId} as ${pinned.target}, and nothing else.`, 403);
  }
  const runId = pinned?.runId ?? asked;
  const claimAfterSeconds = pinned ? 0 : (typeof body.claimAfterSeconds === 'number' && body.claimAfterSeconds >= 0 ? body.claimAfterSeconds : 0);
  try {
    assertExternalWorkersEnabled();
    const claimed = await claimNextRun({ target, workerId, workerVersion: str(body, 'workerVersion'), claimAfterSeconds, runId, scope: credential.scope });
    if (!claimed) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json({ run: claimed.run, leaseExpiresAt: claimed.run.leaseExpiresAt, runToken: claimed.runToken, git: claimed.git });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
