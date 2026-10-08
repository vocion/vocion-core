import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import { mfaCompletionProof, unstable_update } from '@/libs/Auth';
import { clientIp } from '@/libs/http/clientIp';
import { tooManyRequests } from '@/libs/rateLimit';
import { checkSecondFactor } from '@/services/auth/mfa';
import { mfaCaller, readJson } from '../_caller';

/**
 * `POST /api/mfa/verify` `{ code }` — the second step of signing in.
 *
 * The caller's password (or Google) has passed and their session is waiting
 * on a code. A right code — from the authenticator app or one recovery code —
 * finishes the sign-in: the session is reissued as a full one, through the
 * JWT callback, with the in-process proof that the code checked out
 * (`mfaCompletionProof` in `libs/Auth.ts`). Five wrong codes lock the second
 * factor for fifteen minutes (429 with `Retry-After`).
 * @param req - `{ code }` as JSON.
 */
export async function POST(req: Request) {
  const caller = await mfaCaller();
  if (!caller || caller.state !== 'verify') {
    return NextResponse.json({ error: 'There is no sign-in waiting for a code. Sign in again.', code: 'NO_PENDING_SIGN_IN' }, { status: 401 });
  }
  const body = await readJson(req);
  if (body instanceof NextResponse) {
    return body;
  }
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code.trim()) {
    return NextResponse.json({ error: 'Enter the code from your authenticator app.', code: 'CODE_REQUIRED' }, { status: 400 });
  }
  const check = await checkSecondFactor(caller.userId, code, { ip: clientIp(req.headers) });
  if (!check.ok) {
    if (check.reason === 'locked') {
      return tooManyRequests({ allowed: false, retryAfterSeconds: check.retryAfterSeconds });
    }
    return NextResponse.json({ error: 'That code did not work. Check your app and try again.', code: 'INVALID_CODE' }, { status: 400 });
  }
  await unstable_update({ mfaProof: mfaCompletionProof(caller.userId) } as Partial<Session>);
  return NextResponse.json({ ok: true, method: check.method });
}
