import { ORPCError, os } from '@orpc/server';
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
import { workforceCommand, WorkforceError } from '@/services/workforce/contracts';
import { readWorkforceOutcomes } from '@/services/workforce/ledger';
import { operatingEvidence } from '@/services/workforce/operating';
import { readPortfolioHistory, readWorkforcePortfolio, saveWorkforcePortfolio } from '@/services/workforce/portfolio';
import { portfolioCommand } from '@/services/workforce/portfolioContract';
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

/** Legacy operational reads remain scoped to the active workspace. */
export const workforceOverviewRoute = os.input(WorkforceWindow).handler(async ({ input }) => {
  const { accountId, userId, orgId } = await guardAdmin();
  const projects = (await listProjectsForUser(userId)).filter(p => p.id === orgId && p.accountId === accountId && !p.archived);
  const workspaces = [];
  const until = new Date();
  const since = new Date(until.getTime() - input.days * 86_400_000);
  // Bound database concurrency even for accounts with many workspaces.
  for (let offset = 0; offset < projects.length; offset += 4) {
    const batch = await Promise.all(projects.slice(offset, offset + 4).map(async project => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      report: await getWorkforceInventory(project.id, input.days),
      outcomes: operatingEvidence(await readWorkforceOutcomes(project.id, since, until, false)),
      portfolio: await readWorkforcePortfolio(project.id),
    })));
    workspaces.push(...batch);
  }
  return { activeId: orgId, workspaces };
});

export const workforceOutcomesRoute = os.input(WorkforceWindow.extend({ test: z.boolean().default(false) })).handler(async ({ input }) => {
  const { orgId } = await guardAdmin();
  const { readWorkforceOutcomes } = await import('@/services/workforce/ledger');
  const until = new Date();
  return readWorkforceOutcomes(orgId, new Date(until.getTime() - input.days * 86_400_000), until, input.test);
});

export const workforceRecordRoute = os.input(workforceCommand).handler(async ({ input }) => {
  const { orgId, userId } = await guardAdmin();
  const { recordWorkforceCommand } = await import('@/services/workforce/ledger');
  try {
    return await recordWorkforceCommand(orgId, userId, input);
  } catch (error) {
    if (error instanceof WorkforceError) {
      throw new ORPCError(error.status === 409 ? 'CONFLICT' : error.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', { status: error.status, message: error.message });
    }
    throw error;
  }
});

export const workforcePortfolioSaveRoute = os.input(portfolioCommand).handler(async ({ input }) => {
  const { orgId, userId } = await guardAdmin();
  try {
    return await saveWorkforcePortfolio(orgId, userId, input);
  } catch (error) {
    if (error instanceof WorkforceError) {
      throw new ORPCError(error.status === 409 ? 'CONFLICT' : error.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', { status: error.status, message: error.message });
    }
    throw error;
  }
});

export const workforcePortfolioHistoryRoute = os.input(z.object({ id: z.string().uuid() }).strict()).handler(async ({ input }) => {
  const { orgId } = await guardAdmin();
  return readPortfolioHistory(orgId, input.id);
});
