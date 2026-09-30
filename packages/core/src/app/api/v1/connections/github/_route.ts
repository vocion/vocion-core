import type { NextRequest } from 'next/server';
import type { ApiCaller } from '@/services/writeApi';
import { NextResponse } from 'next/server';
import { publicOrigin } from '@/libs/http/publicOrigin';
import { requireCapability } from '../../_shared';

/**
 * The shared door of the GitHub connection routes: a signed-in person who may
 * manage this workspace's connections, and the public origin to send them
 * back to. A browser without a session is sent to sign in and returned here.
 * @param request - The request.
 * @param caller - What `authApi(request)` answered for it. Without credentials, a
 *   browser is sent to sign in and brought back; any other caller gets the 401.
 */
export function connectionDoor(request: NextRequest, caller: ApiCaller | NextResponse): { caller: ApiCaller; origin: string } | NextResponse {
  const origin = publicOrigin(request);
  if (caller instanceof NextResponse) {
    // A browser on its way to or from GitHub is sent to sign in and brought
    // back; anything else gets the API's own 401.
    if (!(request.headers.get('accept') ?? '').includes('text/html')) {
      return caller;
    }
    const signIn = new URL('/sign-in', origin);
    signIn.searchParams.set('callbackUrl', new URL(request.nextUrl.pathname + request.nextUrl.search, origin).toString());
    return NextResponse.redirect(signIn);
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  return { caller, origin };
}
