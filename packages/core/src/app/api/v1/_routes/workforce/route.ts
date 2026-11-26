import { NextResponse } from 'next/server';
import { workforceCommand, WorkforceError } from '@/services/workforce/contracts';
import { readWorkforceOutcomes, recordWorkforceCommand } from '@/services/workforce/ledger';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireWorkspaceAdmin, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/workforce
 * Read workspace business outcomes and learning evidence.
 * Requires workspace administrator access. Outcome rows cover items updated in the
 * window; learning assets are current stock. Missing gold-standard provenance and
 * validated improvement remain null. No raw eval cases or feedback payloads are returned.
 * Query parameters:
 * - `days` — Rolling window: 1, 7, 30 or 90; default 7.
 * - `test` — true selects synthetic outcome records only and omits learning metrics.
 * @param req - The authenticated request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'read workforce outcomes');
  if (denied) {
    return denied;
  }
  const params = new URL(req.url).searchParams;
  const days = Number(params.get('days') ?? 7);
  if (![1, 7, 30, 90].includes(days)) {
    return jsonError('VALIDATION_FAILED', 'days must be 1, 7, 30 or 90', 400);
  }
  const until = new Date();
  return NextResponse.json(await readWorkforceOutcomes(caller.orgId, new Date(until.getTime() - days * 86_400_000), until, params.get('test') === 'true'), { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * POST /api/v1/workforce
 * Register work, attach evidence or record a human outcome.
 * Requires workspace administrator access; review commands require a session.
 * Body is a strict workforce command with kind create, link or review and eventKey.
 * Create requires key, workflow, title, agentSlug, rubric and configurationVersion.
 * Optional baselineKind is assumed (sample size 0) or measured (positive sample size);
 * both require baselineMinutes and baselineEvidence. Omitted provenance is unverified.
 * Link requires itemId, version, sourceKind (action, worker or mission) and sourceId.
 * Mission links include persisted task-graph evidence; task completion is not acceptance. Review requires itemId,
 * version, status, reason and evidence; effortMinutes records active effort only.
 * Exact event replay returns its existing receipt; changed payloads or stale revisions
 * return 409, and foreign or missing items return 404. Synthetic create uses test=true.
 * @param req - The authenticated request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'record workforce outcomes');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const parsed = workforceCommand.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', 'Invalid workforce command', 400);
  }
  if (parsed.data.kind === 'review' && caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'Human outcome reviews require a signed-in reviewer', 403);
  }
  try {
    return NextResponse.json(await recordWorkforceCommand(caller.orgId, caller.actorId, parsed.data));
  } catch (error) {
    if (error instanceof WorkforceError) {
      return jsonError(error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED', error.message, error.status);
    }
    return writeApiErrorResponse(error);
  }
}
