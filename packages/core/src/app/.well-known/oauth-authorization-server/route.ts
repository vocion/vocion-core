import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { publicOrigin } from '@/libs/http/publicOrigin';
import { authorizationServerMetadata } from '@/services/OAuthService';

/**
 * RFC 8414: where an MCP client finds the sign-in endpoints (backlog 027).
 * @param req
 */
export function GET(req: NextRequest) {
  return NextResponse.json(authorizationServerMetadata(publicOrigin(req)), { headers: { 'cache-control': 'public, max-age=300' } });
}
