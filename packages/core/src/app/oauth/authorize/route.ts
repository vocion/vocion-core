import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { publicOrigin } from '@/libs/http/publicOrigin';
import { beginAuthorization, OAuthError } from '@/services/OAuthService';

/**
 * The assistant sends the person here; the request is checked and kept, and
 * the person goes to the consent page in the app (signing in on the way if
 * they must) to approve it (backlog 027).
 * @param req
 */
export async function GET(req: NextRequest) {
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  try {
    const started = await beginAuthorization(q);
    return NextResponse.redirect(`${publicOrigin(req)}/dashboard/connect?request=${encodeURIComponent(started.id)}`);
  } catch (e) {
    if (e instanceof OAuthError) {
      return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status });
    }
    throw e;
  }
}
