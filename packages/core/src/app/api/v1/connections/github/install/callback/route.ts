import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { finishInstall } from '@/services/github/GithubConnectFlow';
import { authApi } from '../../../../_shared';
import { connectionDoor } from '../../_route';

/**
 * GET /api/v1/connections/github/install/callback — back from GitHub's
 * install screen, then from the GitHub sign-in that proves the person can
 * reach the installation; the installation is bound to the workspace
 * (backlog 053).
 * @param request - The request.
 */
export async function GET(request: NextRequest) {
  const door = connectionDoor(request, await authApi(request));
  if (door instanceof NextResponse) {
    return door;
  }
  const q = request.nextUrl.searchParams;
  const { redirect } = await finishInstall({
    ...door,
    query: { installationId: q.get('installation_id'), setupAction: q.get('setup_action'), state: q.get('state'), code: q.get('code') },
  });
  return NextResponse.redirect(redirect);
}
