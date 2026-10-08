import type { DefaultSession, NextAuthConfig } from 'next-auth';
import type { Adapter } from 'next-auth/adapters';
import type { IdTokenClaims } from './identity/trustedEmail';
import type { WorkspaceRole } from '@/services/authz';
import process from 'node:process';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcrypt from 'bcrypt';
import { eq, lt } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { headers } from 'next/headers';
import { cache } from 'react';
import { z } from 'zod';
import { authAccountSchema, sessionSchema, userSchema, verificationTokenSchema } from '@/models/Schema';
import { emailLinkConfigured, emailLinkProvider, forwardedClientIp, linkRequestAnswer } from '@/services/auth/emailLink';
import { db } from './DB';
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
  }
}

/**
 * The Drizzle adapter, with three changes that keep sign-in invite-only and
 * keep provider tokens out of the database:
 *
 * - **`createUser` refuses.** Auth.js would make a user for any Google,
 *   Microsoft or email-link sign-in it has no user for. Here a login is made
 *   only by accepting an invite (`acceptInviteAsNewUser`), which the `signIn`
 *   callback does before Auth.js looks for the user — so by the time Auth.js
 *   would create one, it finds one instead. If it ever does not, nothing is
 *   created.
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
    return forwardedClientIp(await headers());
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
 *   accepts an invite, or answers with the sign-in page that says why not.
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

export const { auth, handlers, signIn, signOut } = NextAuth({
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
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }
        const { email, password } = parsed.data;
        const [user] = await db
          .select()
          .from(userSchema)
          .where(eq(userSchema.email, email.toLowerCase()))
          .limit(1);
        if (!user?.passwordHash) {
          return null;
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          return null;
        }
        return { id: user.id, email: user.email, name: user.name ?? undefined, image: user.image ?? undefined };
      },
    }),
    // "Continue with Google" / "Continue with Microsoft" — each only when its
    // client id and secret are set (`libs/identity/signInProviders.ts`).
    ...configuredSignInProviders().map(descriptor => descriptor.build(process.env)),
    // "Email me a sign-in link" — only when outbound mail is configured.
    ...(emailLinkConfigured() ? [emailLinkProvider()] : []),
  ],
  events: {
    // A provider linked to a login, on first use or from the profile page.
    // Recorded on the adoption stream; never stops the sign-in it rides on.
    async linkAccount({ user, account }) {
      try {
        const tenancy = user.id ? await resolveTenancyForUser(user.id) : null;
        if (user.id && tenancy?.projectId) {
          const { recordSignInMethodChange } = await import('@/services/auth/signInMethods');
          await recordSignInMethodChange({ orgId: tenancy.projectId, projectId: tenancy.projectId, accountId: tenancy.accountId, userId: user.id }, 'linked', account.provider);
        }
      } catch {
        // Telemetry about a sign-in; the sign-in goes on without it.
      }
    },
  },
  callbacks: {
    signIn: signInCallback,
    async jwt({ token, user, trigger }) {
      // On first sign-in, `user` is set — populate id + resolve tenancy.
      if (user?.id) {
        token.id = user.id;
        // Everyone has their own workspace in each of their accounts, made the
        // first time they sign in there. Never throws: a failure is logged and
        // the next sign-in tries again, so it can never stop a sign-in.
        const { ensurePersonalProjectsForUser } = await import('@/services/workspace/personalProject');
        await ensurePersonalProjectsForUser(user.id);
        const tenancy = await resolveTenancyForUser(user.id);
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
            userId: user.id,
          });
        }
      } else if (trigger === 'update' && typeof token.id === 'string') {
        // Session.update() (e.g. after project switch) — re-resolve tenancy so
        // the new vocion_active_project cookie is honored on the next issue.
        const tenancy = await resolveTenancyForUser(token.id);
        token.accountId = tenancy.accountId;
        token.projectId = tenancy.projectId;
        token.role = tenancy.role;
        token.workspaceRole = tenancy.workspaceRole;
      }
      return token;
    },
    async session({ session, token }) {
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
    },
  },
});

/**
 * Hash a password with bcrypt. Used by the seed scripts and the profile page;
 * the implementation lives in `libs/identity/password.ts`, which a service
 * can import without loading this configuration.
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
