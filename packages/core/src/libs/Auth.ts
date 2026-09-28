import type { DefaultSession } from 'next-auth';
import type { WorkspaceRole } from '@/services/authz';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authAccountSchema, sessionSchema, userSchema, verificationTokenSchema } from '@/models/Schema';
import { db } from './DB';
import { resolveTenancyForUser } from './tenancy';

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
        const tenancy = await resolveTenancyForUser(token.id);
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
