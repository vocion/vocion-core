import type { DefaultSession, NextAuthConfig, Session } from 'next-auth';
import type { Adapter } from 'next-auth/adapters';
import type { JWT } from 'next-auth/jwt';
import type { IdTokenClaims } from './identity/trustedEmail';
import type { SignInGate } from '@/services/auth/mfa';
import type { WorkspaceRole } from '@/services/authz';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { lt } from 'drizzle-orm';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { headers } from 'next/headers';
import { cache } from 'react';
import { z } from 'zod';
import { authAccountSchema, sessionSchema, userSchema, verificationTokenSchema } from '@/models/Schema';
import { emailLinkConfigured, emailLinkProvider, linkRequestAnswer } from '@/services/auth/emailLink';
import { checkPassword } from '@/services/auth/passwordCheck';
import { currentSessionVersion } from '@/services/auth/sessionVersion';
import { db } from './DB';
import { clientIp } from './http/clientIp';
import { hashPassword as hashPasswordWithBcrypt } from './identity/password';
import { configuredSignInProvider, configuredSignInProviders } from './identity/signInProviders';
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

/** The session version a token must carry, read once per server render like the tenancy. */
const sessionVersionForRender = cache(currentSessionVersion);

/**
 * How long a half-signed-in session (one still owing a second factor) lasts.
 * Past it the person starts again at the password, so a password alone does
 * not buy a cookie that can keep retrying codes or start an enrolment for the
 * whole life of a session.
 */
export const HELD_SIGN_IN_TTL_MS = 10 * 60_000;

/**
 * How recent a sign-in must be to stand in for the password where a person
 * without one (who signs in through Google, Microsoft or an email link) is
 * asked to prove it is still them.
 */
export const RECENT_SIGN_IN_MS = 10 * 60_000;

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
    /**
     * When the last factor of this session's sign-in passed (ms since the
     * epoch), or null when the session is not signed in or predates the
     * field. Read where a person with no password must have signed in
     * recently (`RECENT_SIGN_IN_MS`).
     */
    authTime?: number | null;
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
    /** When the first factor passed and the hold began; a hold older than `HELD_SIGN_IN_TTL_MS` is signed out. */
    mfaSince?: number | null;
    /** `user.session_version` when this session was issued; an older number reads as signed out. */
    sessionVersion?: number;
    /** When the last factor passed (`Session.authTime`). */
    authTime?: number | null;
  }
}

/**
 * A credentials sign-in refused by a rate limit or a lockout. The code rides
 * the redirect URL back to the form (`?code=rate_limited`), which says to wait
 * rather than "wrong password". Made on first use rather than at module load,
 * so a test that stands in for `next-auth` without `CredentialsSignin` can
 * still load this file.
 */
let RateLimitedSignIn: (new () => Error) | null = null;

function rateLimitedSignIn(): Error {
  RateLimitedSignIn ??= class extends CredentialsSignin {
    override code = 'rate_limited';
  };
  return new RateLimitedSignIn();
}

/**
 * Proof, made inside this process, that the server itself asked for a session
 * change.
 *
 * Finishing a two-step sign-in, and keeping the session a person changed their
 * password from, rewrite the session cookie through `unstable_update`, which
 * runs the `jwt` callback below with the data it was given. A browser can drive
 * that same callback with any data it likes by POSTing to `/api/auth/session`,
 * so the callback must not believe a bare "verified" or "keep me". The route
 * that did the checking hands the callback a proof instead: an HMAC under a key
 * minted when this module loaded, which never leaves the process —
 * `unstable_update` calls Auth.js in process, not over HTTP — bound to the
 * person and to what it proves, and good for one minute.
 */
const PROOF_KEY = randomBytes(32);
const PROOF_TTL_MS = 60_000;

type ProofPurpose = 'mfa-complete' | 'session-refresh';

function proofMac(purpose: ProofPurpose, userId: string, issuedAt: number): Buffer {
  return createHmac('sha256', PROOF_KEY).update(`${purpose}:${userId}:${issuedAt}`).digest();
}

function mintProof(purpose: ProofPurpose, userId: string, now: number): string {
  return `${now}.${proofMac(purpose, userId, now).toString('base64url')}`;
}

function isProof(purpose: ProofPurpose, value: unknown, userId: string, now: number): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const [issued, mac] = value.split('.');
  const issuedAt = Number(issued);
  if (!mac || !Number.isFinite(issuedAt) || now - issuedAt > PROOF_TTL_MS || issuedAt > now + 5_000) {
    return false;
  }
  const expected = proofMac(purpose, userId, issuedAt);
  const given = Buffer.from(mac, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The proof `/api/mfa/verify` (and enrolment at sign-in) passes to
 * `unstable_update({ mfaProof })` once a code has checked out.
 * @param userId - The person whose second factor passed.
 * @param now - The current time in ms; tests pass one.
 */
export function mfaCompletionProof(userId: string, now: number = Date.now()): string {
  return mintProof('mfa-complete', userId, now);
}

/**
 * Whether `value` is a fresh second-factor proof for `userId` minted by this process.
 * @param value - What the session update carried.
 * @param userId - The session's person.
 * @param now - The current time in ms; tests pass one.
 */
export function isMfaCompletionProof(value: unknown, userId: string, now: number = Date.now()): boolean {
  return isProof('mfa-complete', value, userId, now);
}

/**
 * The proof `keepThisSession` passes to `unstable_update({ sessionProof })`
 * after a change that ended the person's other sessions.
 * @param userId - The person.
 * @param now - The current time in ms; tests pass one.
 */
export function sessionRefreshProof(userId: string, now: number = Date.now()): string {
  return mintProof('session-refresh', userId, now);
}

/**
 * Whether `value` is a fresh session-refresh proof for `userId` minted by this process.
 * @param value - What the session update carried.
 * @param userId - The session's person.
 * @param now - The current time in ms; tests pass one.
 */
export function isSessionRefreshProof(value: unknown, userId: string, now: number = Date.now()): boolean {
  return isProof('session-refresh', value, userId, now);
}

/**
 * Whether a half-signed-in token has outlived `HELD_SIGN_IN_TTL_MS`. A hold
 * with no start time is treated as expired.
 * @param token - The token.
 * @param now - The current time in ms; tests pass one.
 */
function heldTooLong(token: JWT, now: number = Date.now()): boolean {
  return typeof token.mfaSince !== 'number' || now - token.mfaSince > HELD_SIGN_IN_TTL_MS;
}

/**
 * Whether a session's sign-in is recent enough to stand in for a password.
 * @param authTime - `Session.authTime`.
 * @param now - The current time in ms; tests pass one.
 */
export function isRecentSignIn(authTime: number | null | undefined, now: number = Date.now()): boolean {
  return typeof authTime === 'number' && now - authTime <= RECENT_SIGN_IN_MS && authTime <= now + 5_000;
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
  token.mfa = null;
  token.mfaSince = null;
  token.authTime = Date.now();
  // Stamped after every change that might raise it in this same request
  // (enrolling at the sign-in gate turns two-step sign-in on, which does).
  token.sessionVersion = (await currentSessionVersion(userId)) ?? 0;
  // Invites to this person's address that are still open — another Org
  // asked them in after they signed up — are accepted now, on the login they
  // already have, under the same rules as an invite link
  // (`services/auth/joinInvites.ts`). Never stops the sign-in: an invite it
  // could not accept keeps its link, and the next sign-in tries again.
  try {
    const { joinPendingInvites } = await import('@/services/auth/joinInvites');
    await joinPendingInvites(userId);
  } catch (error) {
    logAuthFailure('joining pending invites at sign-in failed; the next sign-in retries', error);
  }
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
 * The Drizzle adapter, with four changes that keep sign-in invite-only and
 * keep provider tokens out of the database:
 *
 * - **`createUser` refuses.** Auth.js would make a user for any Google,
 *   Microsoft or email-link sign-in it has no user for. Here a login is made
 *   only by accepting an invite (`acceptInviteAsNewUser`) or, where an
 *   operator opted in, by an address in an auto-join domain
 *   (`services/auth/autoJoin.ts`) — both done by the `signIn` callback before
 *   Auth.js looks for the user, so by the time Auth.js would create one, it
 *   finds one instead. If it ever does not, nothing is created.
 * - **`getUser` answers nothing.** Under JWT sessions Auth.js uses it for one
 *   thing: linking a provider account to whoever this browser is already
 *   signed in as, whatever address that account has. Sign-in here resolves a
 *   person by the provider link or by the verified address only, so linking
 *   from the profile page goes through the same rules as signing in.
 * - **`linkAccount` keeps who, not the keys.** A link stores the provider and
 *   the person's id there; the access, refresh and ID tokens are dropped.
 *   Sign-in needs nothing else, and every other credential this deployment
 *   holds is vault-encrypted, so plaintext tokens here would be the exception.
 * - **Spent links are swept.** Each new email-link token clears the expired
 *   ones first. Tokens are issued for every address asked about (so the
 *   answer reveals nothing), and nothing else would ever remove those.
 *
 * Exported for its test.
 */
export function buildAdapter(): Adapter {
  const adapter = DrizzleAdapter(db, {
    usersTable: userSchema,
    accountsTable: authAccountSchema,
    sessionsTable: sessionSchema,
    verificationTokensTable: verificationTokenSchema,
  });
  const linkAccount = adapter.linkAccount!.bind(adapter);
  const createVerificationToken = adapter.createVerificationToken!.bind(adapter);
  return {
    ...adapter,
    createVerificationToken: async (token) => {
      await db.delete(verificationTokenSchema).where(lt(verificationTokenSchema.expires, new Date()));
      return createVerificationToken(token);
    },
    createUser: async () => {
      throw new Error('Logins are created by accepting an invite, never by Auth.js.');
    },
    getUser: async () => null,
    linkAccount: account => linkAccount({ ...account, access_token: undefined, refresh_token: undefined, id_token: undefined }),
  };
}

type SignInParams = Parameters<NonNullable<NonNullable<NextAuthConfig['callbacks']>['signIn']>>[0];

/**
 * The caller's network address, when this runs inside a request.
 */
async function callerIp(): Promise<string | null> {
  try {
    return clientIp(await headers());
  } catch {
    return null;
  }
}

/**
 * The `signIn` callback: the invite-only gate for every way in except the
 * password (which `authorize` already decided).
 *
 * - Asking for an email link: counted against the link limits, and otherwise
 *   always "sent" — whether a link really goes is decided off the request
 *   path (`services/auth/emailLink.ts`), so the answer reveals nothing.
 * - Using an email link, or coming back from Google or Microsoft:
 *   `admitSignIn` (`services/auth/externalSignIn.ts`) signs in, links,
 *   accepts an invite, joins an auto-join domain's Org, or answers with the
 *   sign-in page that says why not.
 *
 * Exported for tests.
 * @param params - Auth.js's `signIn` callback parameters.
 * @param params.user - The user Auth.js resolved or the provider's profile.
 * @param params.account - The provider and the person's id there.
 * @param params.profile - The provider's raw ID token claims (OAuth).
 * @param params.email - Set while an email link is being requested.
 */
export async function signInCallback({ user, account, profile, email }: SignInParams): Promise<boolean | string> {
  if (!account || account.type === 'credentials') {
    return true;
  }
  if (account.type === 'email') {
    const address = (user.email ?? account.providerAccountId).toLowerCase();
    if (email?.verificationRequest) {
      return linkRequestAnswer({ email: address, ip: await callerIp() });
    }
    const { admitSignIn } = await import('@/services/auth/externalSignIn');
    return admitSignIn({ method: 'email-link', email: address });
  }
  const descriptor = configuredSignInProvider(account.provider);
  if (!descriptor) {
    return false;
  }
  const { admitSignIn } = await import('@/services/auth/externalSignIn');
  return admitSignIn({
    method: 'oauth',
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    identity: descriptor.trustedEmail(profile as IdTokenClaims | undefined),
    name: user.name ?? null,
  });
}

type AuthCallbacks = NonNullable<NextAuthConfig['callbacks']>;
type JwtParams = Parameters<NonNullable<AuthCallbacks['jwt']>>[0];
type SessionParams = { session: Session; token: JWT };

/**
 * The password step of signing in (the Credentials provider's `authorize`).
 * The attempt is counted against the lockout before the password is compared
 * (`services/auth/passwordCheck.ts`), so a locked email costs no bcrypt,
 * reveals nothing, and a parallel burst gets no more tries than a sequence.
 * `/api/auth/[...nextauth]` answers the same lockout with an early 429 before
 * this runs. Exported so the lockout can be tested without Auth.js.
 * @param raw - The submitted form fields.
 * @param request - The sign-in request, for the caller's address.
 */
export async function authorizeCredentials(raw: Partial<Record<string, unknown>>, request?: Request) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const check = await checkPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    ip: request ? clientIp(request.headers) : null,
  });
  if (!check.ok) {
    if (check.reason === 'locked') {
      throw rateLimitedSignIn();
    }
    return null;
  }
  const { user } = check;
  return { id: user.id, email: user.email, name: user.name ?? undefined, image: user.image ?? undefined };
}

function logAuthFailure(message: string, error: unknown): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.error(message, { error: error instanceof Error ? error.message : String(error) }))
    .catch(() => {});
}

/**
 * Issue (and reissue) the session token. On the first factor it decides what
 * sign-in still owes (`mfa`, with when the hold began); a half-signed-in token
 * changes only when the in-process proof says the second factor passed, and a
 * signed-in token takes a new session version only on the in-process proof
 * `keepThisSession` sends. Exported for tests.
 * @param params - Auth.js's JWT callback parameters.
 * @param params.token - The token being issued.
 * @param params.user - The user, on the first factor only.
 * @param params.trigger - `signIn`, `signUp` or `update`.
 * @param params.session - The data an `update` carried.
 */
export async function jwtCallback({ token, user, trigger, session }: JwtParams): Promise<JWT> {
  // On first sign-in, `user` is set — the first factor just passed.
  if (user?.id) {
    token.id = user.id;
    const { signInGateFor } = await import('@/services/auth/mfa');
    const gate = await signInGateFor(user.id);
    if (gate) {
      token.mfa = gate;
      token.mfaSince = Date.now();
    } else {
      await completeSignIn(token, user.id);
    }
    return token;
  }
  if (trigger === 'update' && typeof token.id === 'string') {
    const data = session as { mfaProof?: unknown; sessionProof?: unknown } | null | undefined;
    if (token.mfa) {
      // A half-signed-in session changes in one way only: the second
      // factor passes, proven by the in-process proof, while the hold is
      // still fresh. Anything else a client sends to /api/auth/session is
      // ignored.
      if (!heldTooLong(token) && isMfaCompletionProof(data?.mfaProof, token.id)) {
        await completeSignIn(token, token.id);
      }
      return token;
    }
    if (isSessionRefreshProof(data?.sessionProof, token.id)) {
      // The person just changed their own sign-in (a new password, two-step
      // on or off), which ended every session issued before it. This is the
      // one they made the change from, so it carries the new number. Only
      // the server can ask for this; a browser cannot mint the proof.
      token.sessionVersion = (await currentSessionVersion(token.id)) ?? token.sessionVersion;
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
 * A session that reads as signed out to every guard: no id, no tenancy.
 * @param session - The session Auth.js built.
 * @param mfa - What sign-in still owes, for a hold the sign-in page finishes.
 */
function signedOut(session: Session, mfa: Session['mfa'] = null): Session {
  session.user.id = '';
  session.user.accountId = null;
  session.user.projectId = null;
  session.user.role = null;
  session.user.workspaceRole = null;
  session.mfa = mfa;
  session.authTime = null;
  return session;
}

/**
 * The session version a token must carry, or undefined when it cannot be read
 * right now. A failed read lets the session stand, like a failing rate-limit
 * store: a database blip must not sign everybody out.
 * @param userId - The person.
 */
async function requiredSessionVersion(userId: string): Promise<number | null | undefined> {
  try {
    return await sessionVersionForRender(userId);
  } catch (error) {
    logAuthFailure('session version could not be read; the session stands', error);
    return undefined;
  }
}

/**
 * The session every `auth()` returns. A half-signed-in token reads as signed
 * out — no id, no tenancy — with `mfa` saying what is left, until the hold is
 * older than `HELD_SIGN_IN_TTL_MS`. A token stamped with an older session
 * version than the person's (a password or two-step change since) reads as
 * signed out, as does one for a person who no longer exists. Exported for tests.
 * @param params - The session and its token.
 * @param params.session - The session Auth.js built.
 * @param params.token - Its decoded token.
 */
export async function sessionCallback({ session, token }: SessionParams): Promise<Session> {
  if (token.mfa && typeof token.id === 'string') {
    // Not signed in yet. The sign-in page reads `mfa` to ask for the code
    // (or the enrolment) that finishes it — until the hold is too old, when
    // the person starts again at the password.
    return heldTooLong(token) ? signedOut(session) : signedOut(session, { state: token.mfa, userId: token.id });
  }
  if (typeof token.id !== 'string' || !token.id) {
    return signedOut(session);
  }
  // Resolve tenancy on every session read so the vocion_active_project
  // cookie is authoritative — no JWT rotation dance needed on switch. The
  // session version is read beside it: a token older than the person's
  // last password or two-step change is a session that change ended.
  const [required, tenancy] = await Promise.all([requiredSessionVersion(token.id), tenancyForRender(token.id)]);
  if (required === null || (typeof required === 'number' && (token.sessionVersion ?? 0) < required)) {
    return signedOut(session);
  }
  session.mfa = null;
  session.authTime = typeof token.authTime === 'number' ? token.authTime : null;
  session.user.id = token.id;
  session.user.accountId = tenancy.accountId;
  session.user.projectId = tenancy.projectId;
  session.user.role = tenancy.role;
  session.user.workspaceRole = tenancy.workspaceRole;
  return session;
}

/**
 * The Auth.js config, built on first use rather than when this module loads.
 * The sign-in providers include an extension's (`libs/extensions.ts`), and an
 * extension's own modules import this one: built at load, the list was read
 * while the enterprise package was still loading and the build failed at
 * "Collecting page data" (Cannot read properties of undefined (reading
 * 'extensions')). Built once and kept, like the object it replaces.
 */
let authConfig: NextAuthConfig | null = null;

function buildAuthConfig(): NextAuthConfig {
  return {
    adapter: buildAdapter(),
    session: { strategy: 'jwt' },
    pages: {
      signIn: '/sign-in',
      // A refused or failed sign-in (no invite, an expired link) lands back on
      // the form with `?error=`, which says so in a sentence, rather than on
      // Auth.js's own page. So does "check your email" after a link request.
      error: '/sign-in',
      verifyRequest: '/sign-in',
    },
    providers: [
      Credentials({
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        authorize: (credentials, request) => authorizeCredentials(credentials, request),
      }),
      // "Continue with Google" / "Continue with Microsoft" — each only when its
      // client id and secret are set (`libs/identity/signInProviders.ts`).
      ...configuredSignInProviders().map(descriptor => descriptor.build(process.env)),
      // "Email me a sign-in link" — only when outbound mail is configured.
      ...(emailLinkConfigured() ? [emailLinkProvider()] : []),
    ],
    events: {
      // A provider linked to a login, on first use or from the profile page.
      // Recorded on the adoption stream and told to the person ("Google added
      // to your sign-in methods"); never stops the sign-in it rides on.
      async linkAccount({ user, account }) {
        try {
          if (user.id) {
            const { signInMethodLinked } = await import('@/services/auth/signInMethods');
            await signInMethodLinked(user.id, account.provider);
          }
        } catch {
          // Telemetry about a sign-in; the sign-in goes on without it.
        }
      },
    },
    callbacks: {
      signIn: signInCallback,
      jwt: jwtCallback,
      session: sessionCallback,
    },
  };
}

export const { auth, handlers, signIn, signOut, unstable_update } = NextAuth(() => (authConfig ??= buildAuthConfig()));

/**
 * Keep the session this request came from after a change that ended the
 * person's other sessions (`services/auth/sessionVersion.ts`): reissue its
 * cookie carrying the new session version, through the same in-process proof
 * the second factor uses. Never throws; if the cookie cannot be reissued the
 * person signs in again, and the server log says why.
 * @param userId - The person whose change it was.
 */
export async function keepThisSession(userId: string): Promise<void> {
  try {
    await unstable_update({ sessionProof: sessionRefreshProof(userId) } as Partial<Session>);
  } catch (error) {
    logAuthFailure('could not reissue the session after a sign-in change; the person signs in again', error);
  }
}

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
