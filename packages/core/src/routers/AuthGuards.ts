import type { OrgRole } from '@/types/Auth';
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { ApiError } from './ApiError';

/**
 * Authentication guards for ORPC API routes
 *
 * Naming Convention: `guard*` functions guard API access by throwing
 * ORPCError with proper HTTP status codes when authentication/authorization fails.
 *
 * For App Router authentication with redirects, use Auth.ts (`require*` functions) instead.
 *
 * Phase 1 transition: Clerk is still the auth source. `orgId` is kept for
 * backwards compatibility with existing service-layer callers. A new
 * `projectId` is resolved from the legacy `proj-<orgId>` mapping created
 * by migration 0022. Phase 2 (auth.js) will replace this whole thing with
 * a session-derived `{ accountId, projectId }`.
 */

const PROJECT_ID_PREFIX = 'proj-';

/**
 * Enforces authentication for ORPC procedures.
 * @returns userId, orgId (legacy), projectId (new), and `has` function for role checking.
 * @throws {ORPCError} 401 Unauthorized - userId or orgId is missing.
 */
export const guardAuth = async () => {
  const { userId, orgId, has } = await auth();

  if (!userId || !orgId) {
    throw ApiError.unauthorized();
  }

  // Resolve projectId from the migration-stamped mapping. If the row is
  // missing (e.g. an org created post-migration), fall through to legacy
  // `proj-<orgId>` shape; the FK ensures the project actually exists.
  const projectId = `${PROJECT_ID_PREFIX}${orgId}`;

  return { orgId, projectId, userId, has };
};

/**
 * Enforces specific role permissions for ORPC procedures.
 * @param role - The required role in the organization.
 * @returns orgId + projectId
 * @throws {ORPCError} 401 Unauthorized - userId or orgId is missing.
 * @throws {ORPCError} 403 Forbidden - user doesn't have the required role.
 */
export const guardRole = async (role: OrgRole) => {
  const { orgId, projectId, has } = await guardAuth();

  if (!has({ role })) {
    throw ApiError.forbidden();
  }

  return { orgId, projectId };
};

/**
 * Hydrate a project row by id. Used by callers that want the full project
 * shape (name, slug, account_id) rather than just the id.
 */
export const loadProject = async (projectId: string) => {
  const [row] = await db
    .select()
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  return row ?? null;
};
