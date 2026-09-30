import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { startManifest } from '@/services/github/GithubConnectFlow';
import { authApi } from '../../../_shared';
import { connectionDoor } from '../_route';

/**
 * GET /api/v1/connections/github/manifest?org=<github org>&name=<app name> —
 * create the deployment's GitHub App (backlog 053): a page that posts the
 * app's manifest to GitHub, where the person clicks Create.
 * @param request - The request.
 */
export async function GET(request: NextRequest) {
  const door = connectionDoor(request, await authApi(request));
  if (door instanceof NextResponse) {
    return door;
  }
  const { html } = startManifest({ ...door, org: request.nextUrl.searchParams.get('org'), name: request.nextUrl.searchParams.get('name') });
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
