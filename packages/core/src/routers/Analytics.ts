import { os } from '@orpc/server';
import { z } from 'zod';
import {
  getAgentDetail,
  getAgentRows,
  getOverview,
  getTrend,
  getUserDetail,
  getUserRows,
} from '@/services/adoption/AdoptionService';
import { getWorkforceInventory } from '@/services/adoption/WorkforceService';
import { listProjectsForUser } from '@/services/ProjectService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Adoption analytics routes (`router.adoption.*`) — admin-only.
 *
 * Tenant isolation: `orgId`/`accountId` come exclusively from the session
 * via the guard; procedure inputs carry only the window and drill-down
 * keys. A member role gets a 403 on every procedure here.
 */

const WindowInput = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) });

async function guardAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN })) {
    throw ApiError.forbidden();
  }
  return { orgId: ctx.orgId, accountId: ctx.accountId, userId: ctx.userId };
}

export const adoptionOverviewRoute = os
  .input(WindowInput)
  .handler(async ({ input }) => {
    const { orgId, accountId } = await guardAdmin();
    return getOverview(orgId, accountId, input.days);
  });

export const adoptionUsersRoute = os
  .input(WindowInput)
  .handler(async ({ input }) => {
    const { orgId, accountId } = await guardAdmin();
    return getUserRows(orgId, accountId, input.days);
  });

export const adoptionAgentsRoute = os
  .input(WindowInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAdmin();
    return getAgentRows(orgId, input.days);
  });

export const adoptionTrendRoute = os
  .input(WindowInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAdmin();
    return getTrend(orgId, input.days);
  });

export const adoptionUserDetailRoute = os
  .input(WindowInput.extend({ userId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId, accountId } = await guardAdmin();
    return getUserDetail(orgId, accountId, input.userId, input.days);
  });

export const adoptionAgentDetailRoute = os
  .input(WindowInput.extend({ agentSlug: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId, accountId } = await guardAdmin();
    return getAgentDetail(orgId, accountId, input.agentSlug, input.days);
  });

const WorkforceWindow = z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]).default(30) });

export const adoptionWorkforceRoute = os
  .input(WorkforceWindow)
  .handler(async ({ input }) => {
    const { orgId } = await guardAdmin();
    return getWorkforceInventory(orgId, input.days);
  });

/** Aggregate only workspaces this admin can open in the current account. */
export const workforceOverviewRoute = os.input(WorkforceWindow).handler(async ({ input }) => {
  const { accountId, userId, orgId } = await guardAdmin();
  const projects = (await listProjectsForUser(userId)).filter(p => p.accountId === accountId && !p.archived);
  const workspaces = [];
  // Bound database concurrency even for accounts with many workspaces.
  for (let offset = 0; offset < projects.length; offset += 4) {
    const batch = await Promise.all(projects.slice(offset, offset + 4).map(async project => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      report: await getWorkforceInventory(project.id, input.days),
    })));
    workspaces.push(...batch);
  }
  return { activeId: orgId, workspaces };
});
