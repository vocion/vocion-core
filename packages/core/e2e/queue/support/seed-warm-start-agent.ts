#!/usr/bin/env tsx
/**
 * seed-warm-start-agent. Gives the warm-chat-start spec's workspace a second
 * agent besides its seeded lead, so the chat opens on an established
 * workspace's empty conversation (`EmptyState`) rather than the lead's
 * first-day introduction (`LeadIntro`). Idempotent. Fictional throughout.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/queue/support/seed-warm-start-agent.ts --email a@b.test
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, projectSchema, userSchema } from '@/models/Schema';

const SLUG = 'pipeline-analyst';

const { values } = parseArgs({ options: { email: { type: 'string' } } });

async function main(): Promise<void> {
  if (!values.email) {
    throw new Error('pass --email <the signed-in admin>');
  }
  const [row] = await db
    .select({ projectId: projectSchema.id })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(eq(userSchema.email, values.email))
    .limit(1);
  if (!row) {
    throw new Error(`no project for ${values.email}: seed the user first`);
  }
  const [existing] = await db.select({ id: agentSchema.id }).from(agentSchema).where(and(eq(agentSchema.orgId, row.projectId), eq(agentSchema.slug, SLUG))).limit(1);
  if (!existing) {
    await db.insert(agentSchema).values({ orgId: row.projectId, slug: SLUG, name: 'Pipeline Analyst', systemPrompt: 'You read the pipeline and say what changed.' });
  }
  process.stdout.write(`${JSON.stringify({ orgId: row.projectId })}\n`);
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
