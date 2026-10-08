import type { DefaultSession, NextAuthConfig, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import type { SignInGate } from '@/services/auth/mfa';
import type { WorkspaceRole } from '@/services/authz';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { cache } from 'react';
import { z } from 'zod';
import { authAccountSchema, sessionSchema, userSchema, verificationTokenSchema } from '@/models/Schema';
import { db } from './DB';
import { googleSignInConfigured } from './identity/google';
import { hashPassword as hashPasswordWithBcrypt, verifyPassword } from './identity/password';
import { clear, hit, peek, RATE_LIMITS } from './rateLimit';
import { resolveTenancyForUser } from './tenancy';

/**
 * The session read's tenancy, resolved once per server render. A dashboard
 * page reads the session in the proxy, the layouts, the shell and the page,
 * and each read resolved the workspace again against the database. Within one
 * render the URL header, Referer and cookie it decides from cannot change.
 * Outside a render (route handlers, scripts) `cache` memoises nothing and
 * this is the plain call.
 */
const tenancyForRender = cache(resolveTenancyForUser);

/**
 * auth.js (next-auth v5) configuration. This is the default auth backend
 * for vocion-core; Clerk is the alternate path used only by vocion-cloud
 * (toggled via VOCION_AUTH_PROVIDER=clerk; not yet wired in this commit).
 *
 * Tenancy: every session carries a `projectId` — the currently-active
 * project for that user. The canonical URL decides it (`/w/<slug>/…`,
 * resolved by `src/proxy.ts` and forwarded as a request header); the
 * `vocion_active_project` cookie is the fallback for a bare `/dashboard/…`
 * URL and for the first project picked at sign-in. See
 * `resolveTenancyForUser` below and `libs/activeProject.ts`.
 */

/** A bcrypt hash of a random string nobody kept: compared against when an email has no password. */
const UNMATCHABLE_HASH = '$2b$10$pRkOzEk/o8AbZjs3ZFhEausYA.tBI4KL789lt5j3pbqpPStDXQjGi';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

declare module 'next-auth' {
  // eslint-disable-next-line ts/consistent-type-definitions -- module augmentation REQUIRES interface; type aliases can't merge into existing declarations.
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      accountId: string | null;
      projectId: string | null;
      role: 'admin' | 'member' | null;
      /**
       * The role held IN `projectId`, which is what `services/authz.ts` turns
       * into grants. Distinct from `role` above, which is account-wide. Null
       * when there is no active project, or when enforcement is off and the
       * account role still stands in for it.
       */
      workspaceRole: WorkspaceRole | null;
    };
    /**
     * Set while sign-in still owes a second factor: the first factor passed,
     * and the person must `verify` a code or `enroll` an authenticator before
     * the session counts. `user.id` is empty meanwhile, so every guard reads
     * the session as signed out; only the sign-in page and `/api/mfa/*` read
     * this. Null once sign-in is complete.
     */
    mfa?: { state: Exclude<SignInGate, null>; userId: string } | null;
  }
}

declare module '@auth/core/jwt' {
  // eslint-disable-next-line ts/consistent-type-definitions -- same as above; JWT must remain an interface for declaration merging.
  interface JWT {
    id: string;
    accountId?: string | null;
    projectId?: string | null;
    role?: 'admin' | 'member' | null;
    workspaceRole?: WorkspaceRole | null;
    /** What sign-in still owes, or null/absent once complete (`Session.mfa`). */
    mfa?: SignInGate;
  }
}

/**
 * A credentials sign-in refused by a rate limit or a lockout. The code rides
 * the redirect URL back to the form (`?code=rate_limited`), which says to wait
 * rather than "wrong password".
 */
class RateLimitedSignIn extends CredentialsSignin {
  override code = 'rate_limited';
}

/**
 * Proof, made inside this process, that a second factor was just checked.
 *
 * Finishing a two-step sign-in rewrites the session cookie through
 * `unstable_update`, which runs the `jwt` callback below with the data it was
 * given. A browser can drive that same callback with any data it likes by
 * POSTing to `/api/auth/session`, so the callback must not believe a bare
 * "verified". `/api/mfa/verify` checks the code (behind the lockout) and then
 * hands the callback this proof: an HMAC under a key minted when this module
 * loaded, which never leaves the process — `unstable_update` calls Auth.js in
 * process, not over HTTP — and is good for one minute.
 */
const MFA_PROOF_KEY = randomBytes(32);
const MFA_PROOF_TTL_MS = 60_000;

function mfaProofMac(userId: string, issuedAt: number): Buffer {
  return createHmac('sha256', MFA_PROOF_KEY).update(`mfa-complete:${userId}:${issuedAt}`).digest();
}

/**
 * The proof `/api/mfa/verify` (and enrolment at sign-in) passes to
 * `unstable_update({ mfaProof })` once a code has checked out.
 * @param userId - The person whose second factor passed.
 * @param now - The current time in ms; tests pass one.
 */
export function mfaCompletionProof(userId: string, now: number = Date.now()): string {
  return `${now}.${mfaProofMac(userId, now).toString('base64url')}`;
}

/**
 * Whether `value` is a fresh proof for `userId` minted by this process.
 * @param value - What the session update carried.
 * @param userId - The session's person.
 * @param now - The current time in ms; tests pass one.
 */
export function isMfaCompletionProof(value: unknown, userId: string, now: number = Date.now()): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const [issued, mac] = value.split('.');
  const issuedAt = Number(issued);
  if (!mac || !Number.isFinite(issuedAt) || now - issuedAt > MFA_PROOF_TTL_MS || issuedAt > now + 5_000) {
    return false;
  }
  const expected = mfaProofMac(userId, issuedAt);
  const given = Buffer.from(mac, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Everything a completed sign-in does: the person's own workspaces, the
 * tenancy on the token, and the login on the adoption stream. Runs once the
 * last factor passes — straight after the password when no second factor is
 * owed, else after the code.
 * @param token - The JWT being issued.
 * @param userId - The person.
 */
async function completeSignIn(token: JWT, userId: string): Promise<void> {
  // Everyone has their own workspace in each of their accounts, made the
  // first time they sign in there. Never throws: a failure is logged and
  // the next sign-in tries again, so it can never stop a sign-in.
  const { ensurePersonalProjectsForUser } = await import('@/services/workspace/personalProject');
  await ensurePersonalProjectsForUser(userId);
  const tenancy = await resolveTenancyForUser(userId);
  token.accountId = tenancy.accountId;
  token.projectId = tenancy.projectId;
  token.role = tenancy.role;
  token.workspaceRole = tenancy.workspaceRole;
  // Sign-in is the one moment JWT auth becomes observable server-side —
  // record it for the adoption stream. Fire-and-forget; never blocks auth.
  if (tenancy.projectId) {
    const { trackLogin } = await import('@/services/adoption/track');
    trackLogin({
      orgId: tenancy.projectId,
      projectId: tenancy.projectId,
      accountId: tenancy.accountId,
      userId,
    });
  }
}

/**
 * The Drizzle adapter, with one change: a user Auth.js creates (Google's first
 * sign-in) gets a `usr-` id like every other user, because code downstream
 * tells a person from an agent by that prefix, and a lowercased email, because
 * every lookup by email assumes one.
 */
function buildAdapter() {
  const adapter = DrizzleAdapter(db, {
    usersTable: userSchema,
    accountsTable: authAccountSchema,
    sessionsTable: sessionSchema,
    verificationTokensTable: verificationTokenSchema,
  });
  const createUser = adapter.createUser!.bind(adapter);
  adapter.createUser = user => createUser({ ...user, id: `usr-${randomUUID()}`, email: user.email.toLowerCase() });
  return adapter;
}

type AuthCallbacks = NonNullable<NextAuthConfig['callbacks']>;
type JwtParams = Parameters<NonNullable<AuthCallbacks['jwt']>>[0];
type SessionParams = { session: Session; token: JWT };

/**
 * The password step of signing in (the Credentials provider's `authorize`).
 * Exported so the lockout around it can be tested without Auth.js.
 * @param raw - The submitted form fields.
 */
export async function authorizeCredentials(raw: Partial<Record<string, unknown>>) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const email = parsed.data.email.toLowerCase();
  // The lockout is checked before the password, so a locked email costs
  // no bcrypt and reveals nothing. `/api/auth/[...nextauth]` answers the
  // same lockout with a 429 before this runs; this is the backstop for
  // anything that reaches the provider another way.
  const locked = await peek(RATE_LIMITS.signInFailuresPerAccount, email);
  if (!locked.allowed) {
    throw new RateLimitedSignIn();
  }
  const [user] = await db
    .select()
    .from(userSchema)
    .where(eq(userSchema.email, email))
    .limit(1);
  // An email with no password still pays for one bcrypt compare, so the
  // time to answer does not say whether the email has a login.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? UNMATCHABLE_HASH) && Boolean(user?.passwordHash);
  if (!user || !ok) {
    // Counted for unknown emails too, so a lockout says nothing about
    // whether the email has a login.
    await hit(RATE_LIMITS.signInFailuresPerAccount, email);
    return null;
  }
  await clear(RATE_LIMITS.signInFailuresPerAccount, email);
  return { id: user.id, email: user.email, name: user.name ?? undefined, image: user.image ?? undefined };
}

/**
 * Issue (and reissue) the session token. On the first factor it decides what
 * sign-in still owes (`mfa`); a half-signed-in token changes only when the
 * in-process proof says the second factor passed. Exported for tests.
 * @param params - Auth.js's JWT callback parameters.
 * @param params.token - The token being issued.
 * @param params.user - The user, on the first factor only.
 * @param params.account - The provider that signed them in.
 * @param params.trigger - `signIn`, `signUp` or `update`.
 * @param params.session - The data an `update` carried.
 */
export async function jwtCallback({ token, user, account, trigger, session }: JwtParams): Promise<JWT> {
  // On first sign-in, `user` is set — the first factor just passed.
  if (user?.id) {
    token.id = user.id;
    if (trigger === 'signUp' && account?.provider === 'google' && user.email) {
      // Google made this user because an invite named their email: accept
      // it (and any other pending one) now, as the invite link would have.
      const { acceptPendingInvitesForNewUser } = await import('@/services/auth/googleSignIn');
      await acceptPendingInvitesForNewUser(user.id, user.email);
    }
    const { signInGateFor } = await import('@/services/auth/mfa');
    const gate = await signInGateFor(user.id);
    token.mfa = gate;
    if (!gate) {
      await completeSignIn(token, user.id);
    }
    return token;
  }
  if (trigger === 'update' && typeof token.id === 'string') {
    if (token.mfa) {
      // A half-signed-in session changes in one way only: the second
      // factor passes, proven by the in-process proof. Anything else a
      // client sends to /api/auth/session is ignored.
      const proof = (session as { mfaProof?: unknown } | null | undefined)?.mfaProof;
      if (isMfaCompletionProof(proof, token.id)) {
        token.mfa = null;
        await completeSignIn(token, token.id);
      }
      return token;
    }
    // Session.update() (e.g. after project switch) — re-resolve tenancy so
    // the new vocion_active_project cookie is honored on the next issue.
    const tenancy = await resolveTenancyForUser(token.id);
    token.accountId = tenancy.accountId;
    token.projectId = tenancy.projectId;
    token.role = tenancy.role;
    token.workspaceRole = tenancy.workspaceRole;
  }
  return token;
}

/**
 * The session every `auth()` returns. A half-signed-in token reads as signed
 * out — no id, no tenancy — with `mfa` saying what is left. Exported for tests.
 * @param params - The session and its token.
 * @param params.session - The session Auth.js built.
 * @param params.token - Its decoded token.
 */
export async function sessionCallback({ session, token }: SessionParams): Promise<Session> {
  if (token.mfa && typeof token.id === 'string') {
    // Not signed in yet: no id, no tenancy. The sign-in page reads `mfa`
    // to ask for the code (or the enrolment) that finishes it.
    session.user.id = '';
    session.user.accountId = null;
    session.user.projectId = null;
    session.user.role = null;
    session.user.workspaceRole = null;
    session.mfa = { state: token.mfa, userId: token.id };
    return session;
  }
  session.mfa = null;
  if (typeof token.id === 'string') {
    session.user.id = token.id;
  }
  // Resolve tenancy on every session read so the vocion_active_project
  // cookie is authoritative — no JWT rotation dance needed on switch.
  if (typeof token.id === 'string') {
    const tenancy = await tenancyForRender(token.id);
    session.user.accountId = tenancy.accountId;
    session.user.projectId = tenancy.projectId;
    session.user.role = tenancy.role;
    session.user.workspaceRole = tenancy.workspaceRole;
  } else {
    session.user.accountId = null;
    session.user.projectId = null;
    session.user.role = null;
    session.user.workspaceRole = null;
  }
  return session;
}

export const { auth, handlers, signIn, signOut, unstable_update } = NextAuth({
  adapter: buildAdapter(),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/sign-in',
    // A refused Google sign-in (no login, no invite) lands back on the form
    // with `?error=AccessDenied`, which says so, rather than on Auth.js's page.
    error: '/sign-in',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
    ...(googleSignInConfigured()
      ? [Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          // Safe here because the signIn callback refuses an unverified email,
          // so linking by email only ever joins a person to their own login.
          allowDangerousEmailAccountLinking: true,
          profile: profile => ({
            id: profile.sub,
            name: profile.name,
            email: profile.email?.toLowerCase(),
            image: profile.picture,
          }),
        })]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') {
        return true;
      }
      // Invite-only holds for Google too: a verified email with a login or a
      // pending invite, or AccessDenied.
      const { googleSignInAllowed } = await import('@/services/auth/googleSignIn');
      return googleSignInAllowed(profile as { email?: string | null; email_verified?: boolean | null } | undefined);
    },
    jwt: jwtCallback,
    session: sessionCallback,
  },
});

/**
 * Hash a password with bcrypt. Used by /api/signup, the seed scripts and the
 * profile page; the implementation lives in `libs/identity/password.ts`.
 * @param password - The password as typed.
 */
export function hashPassword(password: string): Promise<string> {
  return hashPasswordWithBcrypt(password);
}

/**
 * Compat shim that mimics Clerk's old `auth()` return shape: `{ userId,
 * orgId, has }`. Use this when migrating call sites from Clerk; rewrite
 * to use `auth()` (session-shaped) when refactoring the call.
 *
 * `orgId` is aliased to `projectId` — see AuthGuards docstring for the
 * back-compat rationale.
 */
export async function clerkAuth(): Promise<{
  userId: string | null;
  orgId: string | null;
  accountId: string | null;
  projectId: string | null;
  role: 'admin' | 'member' | null;
  /** The role held in `projectId`, resolved per request. */
  workspaceRole: WorkspaceRole | null;
  has: (args: { role: string }) => boolean;
}> {
  const session = await auth();
  const role = session?.user?.role ?? null;
  return {
    userId: session?.user?.id ?? null,
    orgId: session?.user?.projectId ?? null,
    accountId: session?.user?.accountId ?? null,
    projectId: session?.user?.projectId ?? null,
    role,
    workspaceRole: session?.user?.workspaceRole ?? null,
    has: ({ role: required }) => {
      if (!role) {
        return false;
      }
      if (required === 'org:admin') {
        return role === 'admin';
      }
      if (required === 'org:member') {
        return role === 'admin' || role === 'member';
      }
      return false;
    },
  };
}
