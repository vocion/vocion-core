import { NextResponse } from 'next/server';
import { testConnection } from '@/services/github/GithubAppService';
import { authApi, isErrorResponse, requireCapability } from '../../../_shared';

/**
 * POST /api/v1/connections/github/test
 *
 * Test connection: every installation of this workspace read again from
 * GitHub (repositories, grant, suspension) and a token minted at the
 * workspace's tier, the way every call mints one. Answers
 * `{ results: [{ installationId, account, ok, message, repos }] }`.
 * Requires the `manage_sources` capability.
 * @param req - The request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  return NextResponse.json({ results: await testConnection(caller.orgId) });
}
