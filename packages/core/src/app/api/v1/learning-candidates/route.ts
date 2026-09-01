import { NextResponse } from 'next/server';
import { isCandidateStatus, listCandidates } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readPagination } from '../_shared';

/**
 * GET /api/v1/learning-candidates
 *
 * Rules the system has proposed but not adopted. Filter with `status`
 * (`pending` | `approved` | `rejected`) and `stepName`; page with `limit` and
 * `offset`. Newest first, with the real total for the filters.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);

  const status = url.searchParams.get('status') ?? undefined;
  if (status !== undefined && !isCandidateStatus(status)) {
    return jsonError('VALIDATION_FAILED', 'status must be one of pending|approved|rejected', 400);
  }

  return NextResponse.json(await listCandidates(caller.orgId, {
    status,
    stepName: url.searchParams.get('stepName') ?? undefined,
    limit,
    offset,
  }));
}
