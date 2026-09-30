import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { finishManifest } from '@/services/github/GithubConnectFlow';
import { authApi } from '../../../../_shared';
import { connectionDoor } from '../../_route';

/**
 * GET /api/v1/connections/github/manifest/callback?code&state — GitHub
 * created the app; its credentials are fetched once and sealed in the vault,
 * and the person is back on Connections (backlog 053).
 * @param request - The request.
 */
export async function GET(request: NextRequest) {
  const door = connectionDoor(request, await authApi());
  if (door instanceof NextResponse) {
    return door;
  }
  const q = request.nextUrl.searchParams;
  const { redirect } = await finishManifest({ ...door, code: q.get('code'), state: q.get('state') });
  return NextResponse.redirect(redirect);
}
