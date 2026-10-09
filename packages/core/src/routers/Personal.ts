/**
 * Personal → Connectors: a person's own connections, and the Org's switch for
 * them (docs/guides/personal-connections.md).
 *
 * Every route acts in the session's workspace only when it is the caller's OWN
 * personal workspace; anywhere else there is nothing to list or disconnect.
 * The switch is the Org admin's, from the same panel.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const connectionsRoute = os.handler(async () => {
  const { orgId, userId, accountId, has } = await guardAuth();
  const { listPersonalConnections, ownPersonalWorkspace, personalConnectionsAllowed } = await import('@/services/personal/connections');
  const own = await ownPersonalWorkspace(orgId, userId);
  if (!own) {
    return { personal: false as const, allowed: false, canChangePolicy: false, connections: [] };
  }
  const allowed = await personalConnectionsAllowed(own.accountId);
  return {
    personal: true as const,
    allowed,
    canChangePolicy: Boolean(accountId) && has({ role: ORG_ROLE.ADMIN }),
    connections: allowed ? await listPersonalConnections(own) : [],
  };
});

export const disconnectRoute = os
  .input(z.object({ connector: z.string().min(1).max(60) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { disconnectPersonalConnection, ownPersonalWorkspace } = await import('@/services/personal/connections');
    const own = await ownPersonalWorkspace(orgId, userId);
    if (!own) {
      throw ApiError.notFound();
    }
    return { removed: await disconnectPersonalConnection(own, input.connector) };
  });

export const setPolicyRoute = os
  .input(z.object({ allowed: z.boolean() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { setPersonalConnectionsAllowed } = await import('@/services/personal/connections');
    await setPersonalConnectionsAllowed(accountId, input.allowed);
    return { allowed: input.allowed };
  });
