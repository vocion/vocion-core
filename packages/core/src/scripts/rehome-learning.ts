/**
 * Move an ADOPTED rule to a different memory namespace — the fix for rules
 * the classifier misfiled before it learned to pick a bucket (email-drafting
 * rules sitting in the CRM-judgment step, live in prod as of 2026-09-15).
 *
 * Pending candidates are re-bucketed on the approval card instead; this script
 * exists because adopted rules have no equivalent control. Moving a rule means
 * re-keying its store entry (the key encodes the namespace path); the
 * occurrence back-links pointing at the old key are re-pointed in the same
 * pass so the evidence chain survives the move.
 *
 * Usage, from packages/core:
 *   npx dotenv -c -- tsx src/scripts/rehome-learning.ts --org <orgId> [--list]
 *   npx dotenv -c -- tsx src/scripts/rehome-learning.ts --org <orgId> --rule <slug or key> --to <namespaceName>
 */

import { and, eq, like, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { memoryNamespaceSchema, memorySchema } from '@/models/Schema';
import { namespaceFilePrefix } from '@/services/MemoryService';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  if (!orgId) {
    throw new Error('pass --org <orgId>');
  }

  const namespaces = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(eq(memoryNamespaceSchema.orgId, orgId))
    .orderBy(memoryNamespaceSchema.id);

  if (process.argv.includes('--list')) {
    const rules = await db
      .select()
      .from(memorySchema)
      .where(and(eq(memorySchema.orgId, orgId), like(memorySchema.key, '/%')))
      .orderBy(memorySchema.key);
    for (const r of rules) {
      const text = String((r.value as { content?: unknown }).content ?? '');
      console.warn(`${r.key} :: ${text.slice(0, 90).replace(/\n/g, ' ')}`);
    }
    return;
  }

  const ruleArg = arg('rule');
  const toName = arg('to');
  if (!ruleArg || !toName) {
    throw new Error('pass --rule <slug or key> --to <namespaceName> (or --list)');
  }
  const target = namespaces.find(ns => ns.name === toName);
  if (!target) {
    throw new Error(`unknown namespace "${toName}" — org has: ${namespaces.map(ns => ns.name).join(', ')}`);
  }

  const slug = ruleArg.includes('/') ? ruleArg.split('/').pop()! : (ruleArg.endsWith('.md') ? ruleArg : `${ruleArg}.md`);
  const [rule] = await db
    .select()
    .from(memorySchema)
    .where(and(eq(memorySchema.orgId, orgId), like(memorySchema.key, `%/${slug}`)));
  if (!rule) {
    throw new Error(`no rule matching "${ruleArg}" in org ${orgId}`);
  }
  const newKey = `${namespaceFilePrefix(target.path)}${slug}`;
  if (rule.key === newKey) {
    console.warn(`rule ${rule.key} is already in ${toName}; nothing to do`);
    return;
  }
  await db
    .update(memorySchema)
    .set({ key: newKey })
    .where(and(eq(memorySchema.orgId, orgId), eq(memorySchema.id, rule.id)));
  await db.execute(sql`
    UPDATE learning_feedback_occurrence SET memory_key = ${newKey}
    WHERE org_id = ${orgId} AND memory_key = ${rule.key}
  `);
  await db.execute(sql`
    UPDATE learning_candidate SET created_memory_key = ${newKey}
    WHERE org_id = ${orgId} AND created_memory_key = ${rule.key}
  `);
  const text = String((rule.value as { content?: unknown }).content ?? '');
  console.warn(`moved ${rule.key} → ${newKey}: ${text.slice(0, 80).replace(/\n/g, ' ')}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
