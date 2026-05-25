import type { OrgRole } from '@/types/Auth';
import { eq } from 'drizzle-orm';
import { auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { ApiError } from './ApiError';

/**
 * Authentication guards for ORPC API routes.
 *
 * Naming Convention: `guard*` functions guard API access by throwing
 * ORPCError with proper HTTP status codes when authentication/authorization
 * fails. For App Router authentication with redirects, use `requireAuth`
 * from `@/utils/Auth` instead.
 *
 * Backed by **auth.js** (next-auth v5) after the Phase 2 cutover. Clerk
 * is no longer wired. The session shape is `{ user: { id, accountId,
 * projectId, role } }`.
 *
 * Back-compat: `orgId` is still returned, aliased to `projectId`. The
 * 23 business-content tables still use the `org_id` column; service
 * queries filter by it. The Phase 1.5 rename (`org_id` column →
 * `project_id`) is a follow-up refactor.
 */

const hasRoleFactory = (role: 'admin' | 'member' | null) =>
  ({ role: requiredRole }: { role: OrgRole }) => {
    if (!role) {
      return false;
    }
    if (requiredRole === 'org:admin') {
      return role === 'admin';
    }
    if (requiredRole === 'org:member') {
      return role === 'admin' || role === 'member';
    }
    return false;
  };

/**
 * Enforces authentication for ORPC procedures.
 * @throws {ORPCError} 401 Unauthorized when no session.
 */
export const guardAuth = async () => {
  const session = await auth();

  if (!session?.user?.id || !session.user.projectId) {
    throw ApiError.unauthorized();
  }

  const { id: userId, accountId, projectId, role } = session.user;
  // Back-compat: legacy service-layer queries filter by `org_id`. The
  // column still stores what callers expect — for auth.js-created rows,
  // org_id == projectId. Phase 1.5 will rename the column.
  return { userId, orgId: projectId, accountId, projectId, role, has: hasRoleFactory(role) };
};

/**
 * Enforces specific role permissions for ORPC procedures.
 * @param role
 * @throws {ORPCError} 401 Unauthorized when no session.
 * @throws {ORPCError} 403 Forbidden when role check fails.
 */
export const guardRole = async (role: OrgRole) => {
  const ctx = await guardAuth();
  if (!ctx.has({ role })) {
    throw ApiError.forbidden();
  }
  return { orgId: ctx.orgId, projectId: ctx.projectId, accountId: ctx.accountId };
};

/**
 * Hydrate a project row by id.
 * @param projectId
 */
export const loadProject = async (projectId: string) => {
  const [row] = await db
    .select()
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  return row ?? null;
};
