import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { isRecentSignIn } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { clientIp } from '@/libs/http/clientIp';
import { isDemoSandbox } from '@/libs/identity/demoSandbox';
import { tooManyRequests } from '@/libs/rateLimit';
import { userSchema } from '@/models/Schema';
import { beginEnrollment } from '@/services/auth/mfa';
import { checkPassword } from '@/services/auth/passwordCheck';
import { mfaCaller } from '../_caller';

/**
 * `POST /api/mfa/enroll` `{ password? }` — start setting up an authenticator:
 * a fresh secret and the QR code that carries it. Nothing changes for sign-in
 * until `/api/mfa/enroll/confirm` checks the first code.
 *
 * Open to a signed-in person (from their profile) and to a person whose
 * account requires two-step sign-in and who has not set it up yet (the
 * sign-in gate, which they reached with their password moments ago). Never to
 * a sign-in that is waiting on a code: that person already has an
 * authenticator, and a password alone must not replace it.
 *
 * From the profile, the person proves it is still them first: their current
 * password (checked behind the sign-in lockout), or — with no password, a
 * Google-only login — a sign-in within the last ten minutes. Otherwise anyone
 * holding a stolen session, or an unlocked laptop, could put an authenticator
 * only they hold in front of the real owner's next sign-in.
 *
 * Refused in the demo sandbox, where every visitor shares one login.
 * @param req - `{ password }` as JSON from the profile; `{}` at the sign-in gate.
 */
export async function POST(req: Request) {
  if (isDemoSandbox()) {
    return NextResponse.json({ error: 'Two-step sign-in is not available in the demo.', code: 'UNAVAILABLE' }, { status: 403 });
  }
  if (!req.headers.get('content-type')?.includes('application/json')) {
    // JSON only: a cross-site HTML form can post text/plain without a CORS
    // preflight, and this route acts on the caller's cookie.
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415 });
  }
  const caller = await mfaCaller();
  if (!caller || caller.state === 'verify') {
    return NextResponse.json({ error: 'Sign in to set up two-step sign-in.', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (caller.state === 'complete') {
    const body = await req.json().catch(() => null) as { password?: unknown } | null;
    const password = typeof body?.password === 'string' ? body.password : '';
    const refused = await proveItIsStillThem(caller, password, clientIp(req.headers));
    if (refused) {
      return refused;
    }
  }
  const started = await beginEnrollment(caller.userId);
  if ('error' in started) {
    return started.error === 'already-enabled'
      ? NextResponse.json({ error: 'Two-step sign-in is already on. Turn it off first to switch apps.', code: 'ALREADY_ENABLED' }, { status: 409 })
      : NextResponse.json({ error: 'Sign in to set up two-step sign-in.', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  return NextResponse.json(started, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The response refusing a signed-in person who has not shown it is still
 * them, or null when they have.
 * @param caller - The signed-in caller.
 * @param caller.userId - Who they are.
 * @param caller.authTime - When their sign-in finished.
 * @param password - The password they typed, if any.
 * @param ip - Their address, when known.
 */
async function proveItIsStillThem(caller: { userId: string; authTime: number | null }, password: string, ip: string | null): Promise<NextResponse | null> {
  const [user] = await db
    .select({ email: userSchema.email, passwordHash: userSchema.passwordHash })
    .from(userSchema)
    .where(eq(userSchema.id, caller.userId))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: 'Sign in to set up two-step sign-in.', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (!user.passwordHash) {
    return isRecentSignIn(caller.authTime)
      ? null
      : NextResponse.json({ error: 'Sign in again to set up two-step sign-in.', code: 'REAUTH_REQUIRED' }, { status: 401 });
  }
  if (!password) {
    return NextResponse.json({ error: 'Enter your password to set up two-step sign-in.', code: 'PASSWORD_REQUIRED' }, { status: 400 });
  }
  const check = await checkPassword({ email: user.email, password, ip });
  if (check.ok) {
    return null;
  }
  return check.reason === 'locked'
    ? tooManyRequests({ allowed: false, retryAfterSeconds: check.retryAfterSeconds })
    : NextResponse.json({ error: 'That password is not right.', code: 'WRONG_PASSWORD' }, { status: 400 });
}
