/**
 * Authentication guards for ORPC API routes
 *
 * Naming Convention: `guard*` functions guard API access by throwing
 * ORPCError with proper HTTP status codes when authentication/authorization fails.
 *
 * For App Router authentication with redirects, use Auth.ts (`require*` functions) instead.
 */
import type { OrgRole } from '@/types/Auth';
import { auth } from '@clerk/nextjs/server';
import { ORPCError } from '@orpc/server';

/**
 * Guards ORPC procedures requiring authentication.
 *
 * @returns Promise containing orgId and has function for role checking
 * @throws ORPCError with 401 status if userId or orgId is missing
 */
export const guardAuth = async () => {
  const { userId, orgId, has } = await auth();

  if (!userId || !orgId) {
    throw new ORPCError('Unauthorized', { status: 401 });
  }

  return { orgId, has };
};

/**
 * Guards ORPC procedures requiring specific role permissions.
 *
 * @param role - The required organization role
 * @returns Promise containing orgId
 * @throws ORPCError with 401 status if not authenticated, 403 if insufficient permissions
 */
export const guardRole = async (role: OrgRole) => {
  const { orgId, has } = await guardAuth();

  if (!has({ role })) {
    throw new ORPCError('Forbidden', { status: 403 });
  }

  return { orgId };
};
