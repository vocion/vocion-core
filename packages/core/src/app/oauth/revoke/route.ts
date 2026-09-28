import { NextResponse } from 'next/server';
import { authenticateBearer, revokeToken } from '@/services/ApiTokenService';

/**
 * RFC 7009: an assistant signs out. The token must be presented as the bearer; anything else is a silent 200, as the RFC asks.
 * @param req
 */
export async function POST(req: Request) {
  const body = Object.fromEntries(new URLSearchParams(await req.text()).entries());
  const raw = typeof body.token === 'string' ? body.token : null;
  const identity = await authenticateBearer(raw ? `Bearer ${raw}` : req.headers.get('authorization'));
  if (identity) {
    await revokeToken(identity.orgId, identity.tokenId);
  }
  return new NextResponse(null, { status: 200 });
}
