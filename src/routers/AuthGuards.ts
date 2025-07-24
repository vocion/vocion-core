import type { OrgRole } from '@/types/Auth';
import { auth } from '@clerk/nextjs/server';
import { ORPCError } from '@orpc/server';

// Authentication helper function
export const requireAuth = async () => {
  const { userId, orgId, has } = await auth();

  if (!userId || !orgId) {
    throw new ORPCError('Unauthorized', { status: 401 });
  }

  return { orgId, has };
};

// Role-based authentication helper function
export const requireRole = async (role: OrgRole) => {
  const { orgId, has } = await requireAuth();

  if (!has({ role })) {
    throw new ORPCError('Forbidden', { status: 403 });
  }

  return { orgId };
};
