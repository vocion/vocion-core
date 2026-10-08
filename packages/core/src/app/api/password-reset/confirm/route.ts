import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/libs/http/clientIp';
import { hit, RATE_LIMITS, tooManyRequests } from '@/libs/rateLimit';
import { MIN_PASSWORD_LENGTH, resetPassword } from '@/services/auth/passwordReset';

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().max(1000),
});

/**
 * `POST /api/password-reset/confirm` `{ token, password }` — spend a reset
 * link and set a new password. A spent, expired or unknown link all read the
 * same ("invalid or expired"); each address gets twenty tries an hour.
 * @param req - `{ token, password }` as JSON.
 */
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Send JSON.', code: 'BAD_REQUEST' }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired.', code: 'INVALID_LINK' }, { status: 400 });
  }
  const ip = clientIp(req.headers);
  const limited = await hit(RATE_LIMITS.passwordResetConfirmPerIp, ip);
  if (!limited.allowed) {
    return tooManyRequests(limited);
  }
  const outcome = await resetPassword({ ...parsed.data, ip });
  if (!outcome.ok) {
    return outcome.reason === 'weak-password'
      ? NextResponse.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, code: 'WEAK_PASSWORD' }, { status: 400 })
      : NextResponse.json({ error: 'This reset link is invalid or has expired.', code: 'INVALID_LINK' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
