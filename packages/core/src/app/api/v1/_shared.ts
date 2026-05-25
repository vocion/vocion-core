import { NextResponse } from 'next/server';
import { clerkAuth as auth } from '@/libs/Auth';

/**
 * Authenticate an API request.
 *
 * Today: Clerk session cookie only (works from a logged-in browser or
 * from any client that presents a Clerk session token). Tenant-scoped
 * Bearer tokens (`cmp_live_...`) are Phase 2.5 — when they land, this
 * helper will accept either.
 */
export async function authApi(): Promise<{ orgId: string } | NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }
  return { orgId };
}

export function jsonError(code: string, message: string, status: number, details?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    { error: { code, message, details: details ?? null } },
    { status },
  );
}
