// auth.js route handler. Exposes /api/auth/* — sign-in, callback, session,
// CSRF, etc. The actual config lives in @/libs/Auth.
//
// One thing happens here before Auth.js sees the request: a password sign-in
// (`POST /api/auth/callback/credentials`) is counted against the caller's
// address and checked against the email's lockout, and a refusal is a 429 with
// `Retry-After`. Inside the provider a refusal can only be a generic
// "CredentialsSignin", which tells neither a script nor a person to wait.
// The 429 body still carries the `url` the next-auth client reads, with
// `code=rate_limited`, so the form says "try again in N minutes".
import type { NextRequest } from 'next/server';
import { handlers } from '@/libs/Auth';
import { clientIp } from '@/libs/http/clientIp';
import { firstRefusal, hit, peek, RATE_LIMITS, tooManyRequests } from '@/libs/rateLimit';

export const { GET } = handlers;

const CREDENTIALS_CALLBACK = /\/api\/auth\/callback\/credentials\/?$/;

/**
 * The email a credentials sign-in names, read from a copy of the form body so
 * Auth.js still gets the original.
 * @param req - The sign-in request.
 */
async function emailOf(req: Request): Promise<string | null> {
  try {
    const form = await req.clone().formData();
    const email = form.get('email');
    return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (CREDENTIALS_CALLBACK.test(new URL(req.url).pathname)) {
    const verdict = firstRefusal(
      await hit(RATE_LIMITS.signInPerIp, clientIp(req.headers)),
      await peek(RATE_LIMITS.signInFailuresPerAccount, await emailOf(req)),
    );
    if (!verdict.allowed) {
      const back = new URL('/sign-in', req.url);
      back.searchParams.set('error', 'CredentialsSignin');
      back.searchParams.set('code', 'rate_limited');
      return tooManyRequests(verdict, {
        url: back.toString(),
        error: 'Too many sign-in attempts.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
    }
  }
  return handlers.POST(req);
}
