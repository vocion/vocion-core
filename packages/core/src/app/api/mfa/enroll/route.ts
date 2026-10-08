import { NextResponse } from 'next/server';
import { beginEnrollment } from '@/services/auth/mfa';
import { mfaCaller } from '../_caller';

/**
 * `POST /api/mfa/enroll` — start setting up an authenticator: a fresh secret
 * and the QR code that carries it. Nothing changes for sign-in until
 * `/api/mfa/enroll/confirm` checks the first code.
 *
 * Open to a signed-in person (from their profile) and to a person whose
 * account requires two-step sign-in and who has not set it up yet (the
 * sign-in gate). Never to a sign-in that is waiting on a code: that person
 * already has an authenticator, and a password alone must not replace it.
 */
export async function POST() {
  const caller = await mfaCaller();
  if (!caller || caller.state === 'verify') {
    return NextResponse.json({ error: 'Sign in to set up two-step sign-in.', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const started = await beginEnrollment(caller.userId);
  if ('error' in started) {
    return started.error === 'already-enabled'
      ? NextResponse.json({ error: 'Two-step sign-in is already on. Turn it off first to switch apps.', code: 'ALREADY_ENABLED' }, { status: 409 })
      : NextResponse.json({ error: 'Sign in to set up two-step sign-in.', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  return NextResponse.json(started, { headers: { 'Cache-Control': 'no-store' } });
}
