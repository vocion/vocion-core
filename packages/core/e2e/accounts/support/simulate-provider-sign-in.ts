#!/usr/bin/env tsx
/**
 * simulate-provider-sign-in — a Google sign-in for the accounts E2E spec,
 * with the provider mocked at the decision function and nowhere else.
 *
 * A real Google round trip needs Google. What this replaces is only that
 * round trip: it hands the app's own Auth.js callbacks exactly what Auth.js
 * hands them when Google comes back — the `oidc` account and the ID token's
 * claims, here with `email_verified` as the spec asks — and then does what
 * Auth.js does next:
 *
 * 1. `signInCallback` (`libs/Auth.ts`) → the invite-only gate
 *    (`admitSignIn` → `decideSignIn`): accept the invite, link, auto-join or
 *    refuse. A refusal is printed and nothing else happens.
 * 2. Auth.js finds the login by the verified address and links the provider
 *    to it through the adapter (`buildAdapter().linkAccount`), then fires its
 *    `linkAccount` event (`signInMethodLinked`).
 * 3. `jwtCallback` issues the session token — `completeSignIn` joins any
 *    other invite still open for the address — and Auth.js's own `encode`
 *    seals it under `AUTH_SECRET`, as the session cookie the browser carries.
 *
 * Prints one JSON line: `{ "refused": "<sign-in page URL>" }` or
 * `{ "userId": "…", "cookie": "…" }`. The spec puts the cookie in the browser
 * and checks what the person can open.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/accounts/support/simulate-provider-sign-in.ts \
 *          --email ole@… [--verified false] [--sub google-123] [--name "Ole"] [--cookie authjs.session-token]
 * Needs AUTH_SECRET and AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (any values: the
 * provider is never called) in the environment.
 */
import type { JWT } from 'next-auth/jwt';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { encode } from 'next-auth/jwt';
import { buildAdapter, jwtCallback, signInCallback } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { authAccountSchema, userSchema } from '@/models/Schema';
import { signInMethodLinked } from '@/services/auth/signInMethods';
import 'dotenv/config';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      verified: { type: 'string', default: 'true' },
      sub: { type: 'string' },
      name: { type: 'string', default: '' },
      cookie: { type: 'string', default: 'authjs.session-token' },
    },
  });
  const email = values.email?.trim().toLowerCase();
  if (!email) {
    throw new Error('--email is required');
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set; the cookie could not be sealed for the server');
  }
  const account = { type: 'oidc' as const, provider: 'google', providerAccountId: values.sub ?? `google-${email}` };
  const profile = { sub: account.providerAccountId, email, email_verified: values.verified !== 'false', name: values.name || undefined };

  // 1. What Auth.js's signIn callback answers.
  const answer = await signInCallback({ user: { name: values.name || null, email }, account, profile } as unknown as Parameters<typeof signInCallback>[0]);
  if (answer !== true) {
    process.stdout.write(`${JSON.stringify({ refused: answer === false ? 'false' : answer })}\n`);
    return;
  }

  // 2. Auth.js finds the login — by the provider link when there is one, else
  //    by the verified address, which it then links Google to.
  const [linked] = await db
    .select({ userId: authAccountSchema.userId })
    .from(authAccountSchema)
    .where(and(eq(authAccountSchema.provider, account.provider), eq(authAccountSchema.providerAccountId, account.providerAccountId)))
    .limit(1);
  const [user] = await db
    .select({ id: userSchema.id, name: userSchema.name })
    .from(userSchema)
    .where(linked ? eq(userSchema.id, linked.userId) : eq(userSchema.email, email))
    .limit(1);
  if (!user) {
    throw new Error(`the gate let ${email} in, but no login exists for it`);
  }
  if (!linked) {
    await buildAdapter().linkAccount!({ userId: user.id, ...account });
    await signInMethodLinked(user.id, account.provider);
  }

  // 3. The session token, as Auth.js issues and seals it.
  const token = await jwtCallback({
    token: { sub: user.id, email, name: user.name } as JWT,
    user: { id: user.id, email, name: user.name },
    account,
    profile,
    trigger: 'signIn',
  } as unknown as Parameters<typeof jwtCallback>[0]);
  const cookie = await encode({ token, secret, salt: values.cookie });
  process.stdout.write(`${JSON.stringify({ userId: user.id, cookie })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[simulate-provider-sign-in] failed', error);
    process.exit(1);
  });
