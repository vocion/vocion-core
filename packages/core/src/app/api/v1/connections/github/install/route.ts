import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { startInstall } from '@/services/github/GithubConnectFlow';
import { authApi } from '../../../_shared';
import { connectionDoor } from '../_route';

/**
 * GET /api/v1/connections/github/install?returnTo=<path> — connect this
 * workspace to GitHub: GitHub's install screen for the deployment's app,
 * where the person picks the organization and repositories (backlog 053).
 * @param request - The request.
 */
export async function GET(request: NextRequest) {
  const door = connectionDoor(request, await authApi(request));
  if (door instanceof NextResponse) {
    return door;
  }
  const { redirect } = await startInstall({ ...door, returnTo: request.nextUrl.searchParams.get('returnTo') });
  return NextResponse.redirect(redirect);
}
