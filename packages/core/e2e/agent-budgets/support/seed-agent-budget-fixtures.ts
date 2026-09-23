#!/usr/bin/env tsx
/**
 * seed-agent-budget-fixtures — the tenant the #272 agent-budget spec drives
 * (`e2e/agent-budgets/agent-budgets.spec.ts`).
 *
 * Builds, in the database the running app is pointed at:
 *   - its own tenant account + project ("e2e-agent-budgets")
 *   - three agents: one with no budget that has spent past the built-in daily
 *     default, one with no budget comfortably under it, and one whose own cap
 *     is set and spent through
 *   - their spend, written through `chargeUsage` — the same call a finished
 *     model call makes — so the rows are shaped exactly like real ones
 *   - one tenant API token, minted through `issueToken`
 *
 * Idempotent: reruns delete this script's own rows first.
 *
 * Prints one JSON line to stdout — the org id and token — after everything
 * else went to stderr.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/agent-budgets/support/seed-agent-budget-fixtures.ts
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentBudgetSchema, agentSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import { chargeUsage, setLimits } from '@/services/BudgetService';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-agent-budgets';
const PROJECT_SLUG = 'e2e-agent-budgets';

/** Priced by `libs/pricing` at one dollar per million input tokens. */
const MODEL = 'claude-haiku-4-5-20251001';

async function resetFixtures(): Promise<void> {
  const [existing] = await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.slug, PROJECT_SLUG)).limit(1);
  if (existing) {
    await db.delete(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, existing.id));
    await db.delete(agentSchema).where(eq(agentSchema.orgId, existing.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

async function main(): Promise<void> {
  await resetFixtures();
  const stamp = Date.now();
  const accountId = `acct-e2e-agent-budgets-${stamp}`;
  await db.insert(tenantAccountSchema).values({ id: accountId, name: 'E2E Agent Budgets', slug: ACCOUNT_SLUG });
  const orgId = `proj-e2e-agent-budgets-${stamp}`;
  await db.insert(projectSchema).values({ id: orgId, accountId, slug: PROJECT_SLUG, name: 'E2E Agent Budgets' });
  console.error(`[seed-agent-budget-fixtures] org: ${orgId}`);

  for (const [slug, name] of [['runaway', 'Runaway'], ['steady', 'Steady'], ['capped', 'Capped']] as const) {
    await db.insert(agentSchema).values({ orgId, slug, name, systemPrompt: 'Be useful.' } as never);
  }
  // $101 on an agent with no budget: past the built-in $100 a day.
  await chargeUsage({ orgId, agentSlug: 'runaway', model: MODEL, usage: { inputTokens: 101_000_000 } });
  // $5 on an agent with no budget: under it.
  await chargeUsage({ orgId, agentSlug: 'steady', model: MODEL, usage: { inputTokens: 5_000_000 } });
  // $3 against the agent's own $2 cap.
  await setLimits({ orgId, agentSlug: 'capped', softCentsLimit: 200, hardCentsLimit: 200 });
  await chargeUsage({ orgId, agentSlug: 'capped', model: MODEL, usage: { inputTokens: 3_000_000 } });

  const token = await issueToken({ orgId, name: 'e2e agent budgets', role: 'owner', createdBy: 'e2e-seed-agent-budget-fixtures' });
  process.stdout.write(`${JSON.stringify({ orgId, token: token.token })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-agent-budget-fixtures] failed:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
