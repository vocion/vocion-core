#!/usr/bin/env tsx
import process from 'node:process';
/**
 * seed-batch-asks. Four open questions on Needs you for the batch spec
 * (`accept-batch.spec.ts`): three whose recommended answer reads "Approve" —
 * one batch — and one that recommends something else and so stands alone.
 *
 * Idempotent: a rerun removes its own asks first, matched on the sourceRef
 * prefix below. The titles share no words on purpose: Needs you folds rows
 * about the same subject into one (`services/inbox/decisionTopic.ts`). Fictional throughout (`libs/fixtures/realDataGuard.ts`). Prints one
 * JSON line, `{ orgId }`; everything else goes to stderr.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/needs-you/support/seed-batch-asks.ts --email a@b.test
 */
import { parseArgs } from 'node:util';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, askSchema, projectSchema, userSchema } from '@/models/Schema';

const SOURCE = 'e2e-needs-you-batch:';

const { values } = parseArgs({ options: { email: { type: 'string' } } });

async function orgOf(email: string): Promise<string> {
  const [row] = await db
    .select({ projectId: projectSchema.id })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(eq(userSchema.email, email))
    .limit(1);
  if (!row) {
    throw new Error(`no project for ${email}: seed the user first`);
  }
  return row.projectId;
}

function approval(orgId: string, title: string, recommended: string, hoursAgo: number) {
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return {
    orgId,
    kind: 'approval',
    title,
    sourceRef: `${SOURCE}${hoursAgo}`,
    body: 'The team recommends an answer; accept it or pick another.',
    agentSlug: 'ops-lead',
    risk: 'low',
    options: [
      { id: 'yes', label: recommended, recommended: true },
      { id: 'no', label: 'Not now' },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

async function main(): Promise<void> {
  if (!values.email) {
    console.error('pass --email <the signed-in admin>');
    process.exit(1);
  }
  const orgId = await orgOf(values.email);
  await db.delete(askSchema).where(and(eq(askSchema.orgId, orgId), like(askSchema.sourceRef, `${SOURCE}%`)));
  await db.insert(askSchema).values([
    approval(orgId, 'Renew the Northwind support contract?', 'Approve', 5),
    approval(orgId, 'Add Kestrel Capital to investor updates?', 'Approve', 4),
    approval(orgId, 'Publish the Contoso Supply case study?', 'approve', 3),
    approval(orgId, 'Move the Acme review to Thursday?', 'Move it', 2),
  ]).onConflictDoNothing();
  process.stdout.write(`${JSON.stringify({ orgId })}\n`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
