import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/libs/http/clientIp';
import { requestOrigin } from '@/libs/http/publicOrigin';
import { tooManyRequests } from '@/libs/rateLimit';
import { requestPasswordReset } from '@/services/auth/passwordReset';

const bodySchema = z.object({ email: z.string().trim().email().max(320) });

/**
 * `POST /api/password-reset` `{ email }` — mail a reset link, if the email
 * has a login.
 *
 * The answer is the same either way, so this cannot be used to find out who
 * has a login: `{ ok: true }` for a known email, an unknown one, and a
 * deployment with outbound mail switched off. Too many requests from one
 * address, or about one email, is a 429 with `Retry-After` — for every email
 * alike. See `services/auth/passwordReset.ts`.
 * @param req - `{ email }` as JSON.
 */
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Send JSON.', code: 'BAD_REQUEST' }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the email you sign in with.', code: 'EMAIL_REQUIRED' }, { status: 400 });
  }
  const outcome = await requestPasswordReset({
    email: parsed.data.email,
    ip: clientIp(req.headers),
    requestOrigin: requestOrigin(req.headers),
  });
  if (!outcome.ok) {
    return tooManyRequests({ allowed: false, retryAfterSeconds: outcome.retryAfterSeconds });
  }
  // The link is issued and mailed after this answer is sent. `after` keeps a
  // serverless host from freezing the work; on a long-running server the
  // promise is already running, and outside a request (a test) there is no
  // `after` to call.
  try {
    after(() => outcome.delivery);
  } catch {
    void outcome.delivery;
  }
  return NextResponse.json({ ok: true });
}
