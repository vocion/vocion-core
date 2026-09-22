import { os } from '@orpc/server';
import { z } from 'zod';
import { getBudget, setLimits } from '@/services/BudgetService';
import { ORG_ROLE } from '@/types/Auth';
import { guardRole } from './AuthGuards';

const PeriodZ = z.enum(['daily', 'monthly']);

export const get = os
  .input(z.object({ agentSlug: z.string(), period: PeriodZ.optional() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardRole(ORG_ROLE.ADMIN);
    return getBudget({ orgId, agentSlug: input.agentSlug, period: input.period });
  });

/**
 * Set the caps on one budget row.
 *
 * `agentSlug` is an agent's slug, or one of the reserved scopes
 * `BudgetService` owns: `platform:all` for a cap over everything this
 * workspace spends, `platform:<feature>` for one non-agent surface such as
 * `platform:retrieval.embed`. The workspace-wide cap is the one that makes
 * `agent_budget` a spend control rather than a per-agent allowance.
 */
export const upsert = os
  .input(z.object({
    agentSlug: z.string(),
    period: PeriodZ.optional(),
    softTokenLimit: z.number().int().nonnegative().nullable().optional(),
    hardTokenLimit: z.number().int().nonnegative().nullable().optional(),
    softCentsLimit: z.number().int().nonnegative().nullable().optional(),
    hardCentsLimit: z.number().int().nonnegative().nullable().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardRole(ORG_ROLE.ADMIN);
    return setLimits({
      orgId,
      agentSlug: input.agentSlug,
      period: input.period,
      softTokenLimit: input.softTokenLimit ?? null,
      hardTokenLimit: input.hardTokenLimit ?? null,
      softCentsLimit: input.softCentsLimit ?? null,
      hardCentsLimit: input.hardCentsLimit ?? null,
    });
  });
