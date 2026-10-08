import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import { keepThisSession, mfaCompletionProof, unstable_update } from '@/libs/Auth';
import { clientIp } from '@/libs/http/clientIp';
import { tooManyRequests } from '@/libs/rateLimit';
import { clearSecondFactorFailures, confirmEnrollment, countSecondFactorAttempt } from '@/services/auth/mfa';
import { mfaCaller, readJson } from '../../_caller';

/**
 * `POST /api/mfa/enroll/confirm` `{ code }` — the first code from the
 * person's app turns two-step sign-in on and returns ten recovery codes,
 * which are never shown again.
 *
 * At the sign-in gate (the account requires it) this also finishes signing
 * in, the same way `/api/mfa/verify` does. From the profile it keeps the
 * session the person set it up from, while turning it on ends their others.
 * Every attempt counts against the same lockout as sign-in codes, counted
 * before the code is checked (`countSecondFactorAttempt`).
 * @param req - `{ code }` as JSON.
 */
export async function POST(req: Request) {
  const caller = await mfaCaller();
  if (!caller || caller.state === 'verify') {
    return NextResponse.json({ error: 'Sign in to set up two-step sign-in.', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const body = await readJson(req);
  if (body instanceof NextResponse) {
    return body;
  }
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code.trim()) {
    return NextResponse.json({ error: 'Enter the code from your authenticator app.', code: 'CODE_REQUIRED' }, { status: 400 });
  }
  const counted = await countSecondFactorAttempt(caller.userId, clientIp(req.headers));
  if (!counted.allowed) {
    return tooManyRequests(counted);
  }
  const result = await confirmEnrollment(caller.userId, code);
  if (!result.ok) {
    if (result.reason === 'invalid') {
      return NextResponse.json({ error: 'That code did not work. Try the newest code your app shows.', code: 'INVALID_CODE' }, { status: 400 });
    }
    return result.reason === 'already-enabled'
      ? NextResponse.json({ error: 'Two-step sign-in is already on.', code: 'ALREADY_ENABLED' }, { status: 409 })
      : NextResponse.json({ error: 'Start setup again — the code you scanned has been replaced.', code: 'ENROLLMENT_REPLACED' }, { status: 409 });
  }
  await clearSecondFactorFailures(caller.userId);
  if (caller.state === 'enroll') {
    await unstable_update({ mfaProof: mfaCompletionProof(caller.userId) } as Partial<Session>);
  } else {
    await keepThisSession(caller.userId);
  }
  return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }, { headers: { 'Cache-Control': 'no-store' } });
}
