import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/libs/http/clientIp';
import { hit, RATE_LIMITS, tooManyRequests } from '@/libs/rateLimit';
import { resetLinkIsLive } from '@/services/auth/passwordReset';

const bodySchema = z.object({ token: z.string().min(1).max(200) });

/**
 * `POST /api/password-reset/check` `{ token }` — whether a reset link is still
 * good, without spending it, so the reset page can say "this link has expired"
 * before the person types a new password. A POST rather than a page read
 * because the token lives in the link's fragment and must never reach a URL a
 * server logs (`services/auth/passwordReset.ts`). Counts against the same
 * per-address budget as `/confirm`: both are a way to try a token.
 * @param req - `{ token }` as JSON.
 */
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Send JSON.', code: 'BAD_REQUEST' }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ live: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const limited = await hit(RATE_LIMITS.passwordResetConfirmPerIp, clientIp(req.headers));
  if (!limited.allowed) {
    return tooManyRequests(limited);
  }
  return NextResponse.json({ live: await resetLinkIsLive(parsed.data.token) }, { headers: { 'Cache-Control': 'no-store' } });
}
