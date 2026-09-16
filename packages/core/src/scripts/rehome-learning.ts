/**
 * Move an ADOPTED rule to a different learning step — the fix for rules the
 * classifier misfiled before it learned to pick a bucket (email-drafting
 * rules sitting in the CRM-judgment step, live in prod as of 2026-09-15).
 *
 * Pending candidates are re-bucketed on the approval card instead; this script
 * exists because adopted rules have no equivalent control.
 *
 * Usage, from packages/core:
 *   npx dotenv -c -- tsx src/scripts/rehome-learning.ts --org <orgId> [--list]
 *   npx dotenv -c -- tsx src/scripts/rehome-learning.ts --org <orgId> --rule <id> --to <stepName>
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { learningSchema, learningStepSchema } from '@/models/Schema';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  if (!orgId) {
    throw new Error('pass --org <orgId>');
  }

  const steps = await db
    .select()
    .from(learningStepSchema)
    .where(eq(learningStepSchema.orgId, orgId))
    .orderBy(learningStepSchema.id);
  const stepById = new Map(steps.map(s => [s.id, s]));

  if (process.argv.includes('--list')) {
    const rules = await db
      .select()
      .from(learningSchema)
      .where(eq(learningSchema.orgId, orgId))
      .orderBy(learningSchema.id);
    for (const r of rules) {
      console.warn(`#${r.id} [${stepById.get(r.stepId)?.name ?? r.stepId}] ${r.ruleText.slice(0, 100)}`);
    }
    return;
  }

  const ruleId = Number(arg('rule'));
  const toStep = arg('to');
  if (!Number.isInteger(ruleId) || !toStep) {
    throw new Error('pass --rule <id> --to <stepName> (or --list)');
  }
  const target = steps.find(s => s.name === toStep);
  if (!target) {
    throw new Error(`unknown step "${toStep}" — org has: ${steps.map(s => s.name).join(', ')}`);
  }
  const [rule] = await db
    .select()
    .from(learningSchema)
    .where(and(eq(learningSchema.orgId, orgId), eq(learningSchema.id, ruleId)));
  if (!rule) {
    throw new Error(`no rule #${ruleId} in org ${orgId}`);
  }
  if (rule.stepId === target.id) {
    console.warn(`rule #${ruleId} is already in ${toStep}; nothing to do`);
    return;
  }
  const from = stepById.get(rule.stepId)?.name ?? String(rule.stepId);
  await db
    .update(learningSchema)
    .set({ stepId: target.id })
    .where(and(eq(learningSchema.orgId, orgId), eq(learningSchema.id, ruleId)));
  console.warn(`moved rule #${ruleId} ${from} → ${toStep}: ${rule.ruleText.slice(0, 80)}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
