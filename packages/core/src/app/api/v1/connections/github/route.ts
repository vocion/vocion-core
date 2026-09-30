import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GITHUB_TIERS } from '@/libs/github/appAuth';
import { connectionView, setInstallationTier } from '@/services/github/GithubAppService';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireCapability } from '../../_shared';

/**
 * GET /api/v1/connections/github
 *
 * The deployment's GitHub App (null before one is created) and this
 * workspace's installations of it: account, repositories, tier, status and
 * the last error a mint met (backlog 053). No secret is ever in the answer.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  return NextResponse.json(await connectionView(caller.orgId));
}

const PatchBody = z.object({ tier: z.enum(GITHUB_TIERS) });

/**
 * PATCH /api/v1/connections/github
 *
 * Body `{ tier: 'base' | 'pipeline' }`: what this workspace's tokens are
 * minted at. `pipeline` adds `workflows: write`, which "the Release engineer
 * may change CI and deploy config" needs.
 * Requires the `manage_sources` capability.
 * @param req - The request.
 */
export async function PATCH(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return jsonError('VALIDATION_FAILED', 'tier must be "base" or "pipeline"', 400);
  }
  await setInstallationTier(caller.orgId, parsed.data.tier);
  return NextResponse.json(await connectionView(caller.orgId));
}
