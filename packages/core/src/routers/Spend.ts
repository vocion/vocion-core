import { os } from '@orpc/server';
import { z } from 'zod';
import { periodRange, SPEND_GROUPS, spendBy } from '@/services/spend/spend';
import { effectiveRole } from '@/services/WorkspaceAccessService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Spend from the ledger, grouped one way over a period (`services/spend/spend.ts`).
 *
 * An Org admin may read the whole Org (`scope: 'org'`, every workspace in it)
 * or this workspace; a workspace admin may read this workspace. Everyone else
 * is refused: spend says who did what work.
 */
export const by = os
  .input(z.object({
    scope: z.enum(['org', 'workspace']).default('workspace'),
    groupBy: z.enum(SPEND_GROUPS),
    period: z.enum(['today', '7d', '30d', '90d']).default('30d'),
    filters: z.object({
      orgId: z.string().optional(),
      agentSlug: z.string().optional(),
      userId: z.string().optional(),
      feature: z.string().optional(),
      model: z.string().optional(),
      runKind: z.string().optional(),
      runId: z.string().optional(),
      conversationId: z.number().int().optional(),
    }).default({}),
  }))
  .handler(async ({ input }) => {
    const ctx = await guardAuth();
    const orgAdmin = ctx.has({ role: ORG_ROLE.ADMIN });
    if (input.scope === 'org' && (!orgAdmin || !ctx.accountId)) {
      throw ApiError.forbidden();
    }
    if (input.scope === 'workspace' && !orgAdmin && await effectiveRole(ctx.userId, ctx.projectId) !== 'admin') {
      throw ApiError.forbidden();
    }
    const { from, to } = periodRange(input.period);
    const scope = input.scope === 'org' && ctx.accountId ? { accountId: ctx.accountId } : { orgId: ctx.orgId };
    const result = await spendBy({ scope, groupBy: input.groupBy, from, to, filters: input.filters });
    return { ...result, from: from.toISOString(), to: to.toISOString() };
  });
