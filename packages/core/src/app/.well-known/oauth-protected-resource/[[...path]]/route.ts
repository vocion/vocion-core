import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { publicOrigin } from '@/libs/http/publicOrigin';
import { protectedResourceMetadata } from '@/services/OAuthService';

/**
 * RFC 9728: which authorization server guards `/api/mcp`. Served at the bare path and at `/api/mcp` beneath it, as clients try both.
 * @param req
 */
export function GET(req: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(req)), { headers: { 'cache-control': 'public, max-age=300' } });
}
