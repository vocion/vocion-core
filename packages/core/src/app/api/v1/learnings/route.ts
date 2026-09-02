import { NextResponse } from 'next/server';
import { listSteps } from '@/services/LearningsService';
import { authApi, isErrorResponse } from '../_shared';

/**
 * GET /api/v1/learnings
 *
 * The org's learning steps with a rule count each — the index a client needs
 * before it can show, add to, or retarget rules.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  return NextResponse.json({ steps: await listSteps(caller.orgId) });
}
