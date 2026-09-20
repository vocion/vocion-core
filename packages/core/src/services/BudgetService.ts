/**
 * BudgetService — per-agent token & dollar caps (Phase 7).
 *
 * Pre-flight check before each run; post-run charge from the Langfuse
 * callback's `on_chat_model_end` hook. Period boundaries (daily /
 * monthly) are checked lazily on charge so the worker doesn't have to
 * fire a cron tick for every period rollover.
 */

import type { TokenUsage } from '@/libs/pricing';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { tokenCostCents, totalTokens } from '@/libs/pricing';
import { agentBudgetSchema } from '@/models/Schema';

export type BudgetPeriod = 'daily' | 'monthly';

export type BudgetCheck
  = | { ok: true }
    | {
      ok: false;
      reason: 'hard_tokens_exceeded' | 'hard_cents_exceeded';
      limit: number;
      current: number;
    };

/* ------------------------------------------------------------------ */
/* Period rollover                                                     */
/* ------------------------------------------------------------------ */

function shouldReset(period: BudgetPeriod, periodStartedAt: Date, now: Date): boolean {
  if (period === 'daily') {
    return now.getUTCFullYear() !== periodStartedAt.getUTCFullYear()
      || now.getUTCMonth() !== periodStartedAt.getUTCMonth()
      || now.getUTCDate() !== periodStartedAt.getUTCDate();
  }
  // monthly
  return now.getUTCFullYear() !== periodStartedAt.getUTCFullYear()
    || now.getUTCMonth() !== periodStartedAt.getUTCMonth();
}

async function getOrCreateBudget(orgId: string, agentSlug: string, period: BudgetPeriod) {
  const [existing] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, orgId),
      eq(agentBudgetSchema.agentSlug, agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
  if (existing) {
    return existing;
  }
  const [created] = await db
    .insert(agentBudgetSchema)
    .values({ orgId, agentSlug, period })
    .returning();
  return created!;
}

async function maybeResetPeriod(row: typeof agentBudgetSchema.$inferSelect) {
  const now = new Date();
  if (!shouldReset(row.period as BudgetPeriod, row.periodStartedAt, now)) {
    return row;
  }
  const [updated] = await db
    .update(agentBudgetSchema)
    .set({ currentTokens: 0, currentCents: 0, periodStartedAt: now })
    .where(eq(agentBudgetSchema.id, row.id))
    .returning();
  return updated!;
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pre-flight check. Call before starting an agent run. Returns
 * `{ ok: true }` when the agent has no hard cap, no budget row yet,
 * or is under the cap. Returns the breach reason when refusing.
 *
 * No-op (returns ok) when no budget row exists — budgets are opt-in.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.period
 */
export async function preflightCheck(opts: {
  orgId: string;
  agentSlug: string;
  period?: BudgetPeriod;
}): Promise<BudgetCheck> {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const [row] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      eq(agentBudgetSchema.agentSlug, opts.agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
  if (!row) {
    return { ok: true };
  }
  const refreshed = await maybeResetPeriod(row);
  if (refreshed.hardTokenLimit !== null && refreshed.currentTokens >= refreshed.hardTokenLimit) {
    return {
      ok: false,
      reason: 'hard_tokens_exceeded',
      limit: refreshed.hardTokenLimit,
      current: refreshed.currentTokens,
    };
  }
  if (refreshed.hardCentsLimit !== null && refreshed.currentCents >= refreshed.hardCentsLimit) {
    return {
      ok: false,
      reason: 'hard_cents_exceeded',
      limit: refreshed.hardCentsLimit,
      current: refreshed.currentCents,
    };
  }
  return { ok: true };
}

/**
 * Charge usage after a model turn completes. Increments both
 * `currentTokens` and `currentCents`. Idempotent only by caller
 * discipline — the callback fires once per turn; don't double-charge.
 *
 * No-op (returns silently) when no budget row exists yet. Budgets
 * are opt-in.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.model
 * @param opts.usage
 * @param opts.period
 */
export async function chargeUsage(opts: {
  orgId: string;
  agentSlug: string;
  model: string;
  usage: TokenUsage;
  period?: BudgetPeriod;
}): Promise<void> {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const [row] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      eq(agentBudgetSchema.agentSlug, opts.agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
  if (!row) {
    return;
  }
  const refreshed = await maybeResetPeriod(row);
  const cents = Math.ceil(tokenCostCents(opts.model, opts.usage));
  const tokens = totalTokens(opts.usage);
  if (cents === 0 && tokens === 0) {
    return;
  }
  await db
    .update(agentBudgetSchema)
    .set({
      currentTokens: sql`${agentBudgetSchema.currentTokens} + ${tokens}`,
      currentCents: sql`${agentBudgetSchema.currentCents} + ${cents}`,
    })
    .where(eq(agentBudgetSchema.id, refreshed.id));
}

/**
 * Provision (or update) a budget row. Use from the budgets UI / CLI
 * to set limits. Caps may be null to disable that dimension.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.period
 * @param opts.softTokenLimit
 * @param opts.hardTokenLimit
 * @param opts.softCentsLimit
 * @param opts.hardCentsLimit
 */
export async function setLimits(opts: {
  orgId: string;
  agentSlug: string;
  period?: BudgetPeriod;
  softTokenLimit?: number | null;
  hardTokenLimit?: number | null;
  softCentsLimit?: number | null;
  hardCentsLimit?: number | null;
}) {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const row = await getOrCreateBudget(opts.orgId, opts.agentSlug, period);
  const [updated] = await db
    .update(agentBudgetSchema)
    .set({
      softTokenLimit: opts.softTokenLimit ?? null,
      hardTokenLimit: opts.hardTokenLimit ?? null,
      softCentsLimit: opts.softCentsLimit ?? null,
      hardCentsLimit: opts.hardCentsLimit ?? null,
    })
    .where(eq(agentBudgetSchema.id, row.id))
    .returning();
  return updated!;
}

export async function listAgentBudgets(orgId: string) {
  const rows = await db
    .select()
    .from(agentBudgetSchema)
    .where(eq(agentBudgetSchema.orgId, orgId));
  // Roll period boundaries before returning so the UI sees the active
  // period's counters (not the stale one from the last run).
  return Promise.all(rows.map(r => maybeResetPeriod(r)));
}

export async function getBudget(opts: { orgId: string; agentSlug: string; period?: BudgetPeriod }) {
  const period: BudgetPeriod = opts.period ?? 'daily';
  const [row] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      eq(agentBudgetSchema.agentSlug, opts.agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
  if (!row) {
    return null;
  }
  return maybeResetPeriod(row);
}

/* ------------------------------------------------------------------ */
/* Headroom — what the workspace has left to spend this period         */
/* ------------------------------------------------------------------ */

/**
 * What every agent budget in this workspace adds up to, in one reading.
 *
 * Budgets are per agent (`agent_budget`), which answers "may this agent take
 * another turn". It does not answer the question adding a teammate asks:
 * whether the workspace can afford another mouth at all. That is the sum, and
 * this is the one place it is taken, so the hire gate and any page reporting
 * it read the same figures rather than each summing the table its own way.
 *
 * Only rows that declare a cents limit are counted. A workspace that has set
 * no limits has no committed allowance and `committedCents` is 0 — budgets are
 * opt-in, and this reports that honestly rather than inventing a ceiling.
 * @param orgId - The workspace.
 * @param period - `daily` (default) or `monthly`.
 */
export async function workspaceHeadroom(orgId: string, period: BudgetPeriod = 'daily'): Promise<{
  period: BudgetPeriod;
  /** Agents with a budget row in this period. */
  agents: number;
  /** Sum of `softCentsLimit` over the rows that declare one. */
  committedCents: number;
  /** Sum of `currentCents` over those same rows. */
  spentCents: number;
  /** `committedCents − spentCents`, floored at nothing — may be negative. */
  headroomCents: number;
  /** True when a soft allowance exists and the period's spend has reached it. */
  overSoft: boolean;
  /** Agent slugs already at or past a HARD cents cap — those cannot run at all. */
  hardStopped: string[];
}> {
  const rows = (await listAgentBudgets(orgId)).filter(r => r.period === period);
  const withSoft = rows.filter(r => r.softCentsLimit !== null);
  const committedCents = withSoft.reduce((sum, r) => sum + (r.softCentsLimit ?? 0), 0);
  const spentCents = withSoft.reduce((sum, r) => sum + r.currentCents, 0);
  const hardStopped = rows
    .filter(r => r.hardCentsLimit !== null && r.currentCents >= r.hardCentsLimit)
    .map(r => r.agentSlug)
    .sort();
  return {
    period,
    agents: rows.length,
    committedCents,
    spentCents,
    headroomCents: committedCents - spentCents,
    overSoft: committedCents > 0 && spentCents >= committedCents,
    hardStopped,
  };
}

/**
 * Delete an agent's budget row for a period. Used by the undo of a hire — the
 * allowance was created with the teammate and goes back with them, so an
 * undone hire leaves no row behind to be re-used by a later agent of the same
 * slug.
 * @param opts - The row to remove.
 * @param opts.orgId - The workspace.
 * @param opts.agentSlug - The agent whose allowance goes back.
 * @param opts.period - `daily` (default) or `monthly`.
 */
export async function removeBudget(opts: { orgId: string; agentSlug: string; period?: BudgetPeriod }): Promise<void> {
  const period: BudgetPeriod = opts.period ?? 'daily';
  await db
    .delete(agentBudgetSchema)
    .where(and(
      eq(agentBudgetSchema.orgId, opts.orgId),
      eq(agentBudgetSchema.agentSlug, opts.agentSlug),
      eq(agentBudgetSchema.period, period),
    ));
}
