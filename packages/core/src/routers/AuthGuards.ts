import type { OrgRole } from '@/types/Auth';
import { auth } from '@clerk/nextjs/server';
import { ApiError } from './ApiError';

/**
 * Authentication guards for ORPC API routes
 *
 * Naming Convention: `guard*` functions guard API access by throwing
 * ORPCError with proper HTTP status codes when authentication/authorization fails.
 *
 * For App Router authentication with redirects, use Auth.ts (`require*` functions) instead.
 */

/**
 * Enforces authentication for ORPC procedures.
 * @returns The orgId and `has` function for role checking.
 * @throws {ORPCError} 401 Unauthorized - userId or orgId is missing.
 */
export const guardAuth = async () => {
  const { userId, orgId, has } = await auth();

  if (!userId || !orgId) {
    throw ApiError.unauthorized();
  }

  return { orgId, has };
};

/**
 * Enforces specific role permissions for ORPC procedures.
 * @param role - The required role in the organization.
 * @returns The orgId
 * @throws {ORPCError} 401 Unauthorized - userId or orgId is missing.
 * @throws {ORPCError} 403 Forbidden - user doesn't have the required role.
 */
export const guardRole = async (role: OrgRole) => {
  const { orgId, has } = await guardAuth();

  if (!has({ role })) {
    throw ApiError.forbidden();
  }

  return { orgId };
};
