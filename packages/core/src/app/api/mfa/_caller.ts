import { NextResponse } from 'next/server';
import { auth } from '@/libs/Auth';

/**
 * Who is calling an `/api/mfa/*` route, and how far through sign-in they are.
 *
 * These routes serve two kinds of caller with one shape: a person who is
 * signed in (setting up two-step sign-in from their profile), and a person
 * half-way through signing in (their password passed; the session holds
 * `mfa` and no user id). Every other route reads the second kind as signed
 * out.
 */
export type MfaCaller = {
  userId: string;
  state: 'complete' | 'verify' | 'enroll';
  /** When a complete session's sign-in finished (`Session.authTime`); null for a hold. */
  authTime: number | null;
};

export async function mfaCaller(): Promise<MfaCaller | null> {
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id, state: 'complete', authTime: session.authTime ?? null };
  }
  if (session?.mfa?.userId) {
    return { userId: session.mfa.userId, state: session.mfa.state, authTime: null };
  }
  return null;
}

/**
 * A JSON body, or the response refusing the request. JSON only: a cross-site
 * HTML form can post text/plain without a CORS preflight, and these routes
 * act on the caller's cookie.
 * @param req - The request.
 */
export async function readJson(req: Request): Promise<Record<string, unknown> | NextResponse> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Send a JSON object.' }, { status: 400 });
  }
  return body as Record<string, unknown>;
}
