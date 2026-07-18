import type { DefaultSession } from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { accountMembershipSchema, authAccountSchema, projectSchema, sessionSchema, userSchema, verificationTokenSchema } from '@/models/Schema';
import { db } from './DB';

const ACTIVE_PROJECT_COOKIE = 'vocion_active_project';

/**
 * auth.js (next-auth v5) configuration. This is the default auth backend
 * for vocion-core; Clerk is the alternate path used only by vocion-cloud
 * (toggled via VOCION_AUTH_PROVIDER=clerk; not yet wired in this commit).
 *
 * Tenancy: every session carries a `projectId` — the currently-active
 * project for that user. For self-hosted "team mode" (1 tenant_account)
 * we pick the user's first project on sign-in. Switching projects flips
 * a `vocion_active_project` cookie that the JWT callback honors on next
 * issue.
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
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: userSchema,
    accountsTable: authAccountSchema,
    sessionsTable: sessionSchema,
    verificationTokensTable: verificationTokenSchema,
  }),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/sign-in',
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
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      // On first sign-in, `user` is set — populate id + resolve tenancy.
      if (user?.id) {
        token.id = user.id;
        const tenancy = await resolveTenancyForUser(user.id);
        token.accountId = tenancy.accountId;
        token.projectId = tenancy.projectId;
        token.role = tenancy.role;
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
        const tenancy = await resolveTenancyForUser(token.id);
        session.user.accountId = tenancy.accountId;
        session.user.projectId = tenancy.projectId;
        session.user.role = tenancy.role;
      } else {
        session.user.accountId = null;
        session.user.projectId = null;
        session.user.role = null;
      }
      return session;
    },
  },
});

/**
 * Find the user's current tenant + active project. Self-hosted: each
 * user belongs to exactly one tenant_account; the active project is
 * whichever the `vocion_active_project` cookie names (if the user has
 * access to it), else the first project on the account.
 * @param userId
 */
async function resolveTenancyForUser(userId: string): Promise<{
  accountId: string | null;
  projectId: string | null;
  role: 'admin' | 'member' | null;
}> {
  const [membership] = await db
    .select({
      accountId: accountMembershipSchema.accountId,
      role: accountMembershipSchema.role,
    })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .limit(1);

  if (!membership) {
    return { accountId: null, projectId: null, role: null };
  }

  // Honor `vocion_active_project` cookie when the named project belongs to
  // the user's account. `cookies()` is available in both Route Handlers and
  // Server Actions — the JWT callback runs in one of those contexts.
  let requestedId: string | undefined;
  try {
    const jar = await cookies();
    requestedId = jar.get(ACTIVE_PROJECT_COOKIE)?.value;
  } catch {
    // cookies() throws when called outside a request scope; fall through
    // to the default first-project selection.
  }

  if (requestedId) {
    const [chosen] = await db
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(and(eq(projectSchema.id, requestedId), eq(projectSchema.accountId, membership.accountId)))
      .limit(1);
    if (chosen) {
      return {
        accountId: membership.accountId,
        projectId: chosen.id,
        role: membership.role as 'admin' | 'member',
      };
    }
  }

  const [proj] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, membership.accountId))
    .limit(1);

  return {
    accountId: membership.accountId,
    projectId: proj?.id ?? null,
    role: membership.role as 'admin' | 'member',
  };
}

/**
 * Hash a password with bcrypt. Used by /api/setup, /api/team/invite/accept,
 * and seed-demo CLI.
 * @param password
 */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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
