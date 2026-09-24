#!/usr/bin/env tsx
import process from 'node:process';
/**
 * seed-bulk-leads. Three briefed leads for the bulk actions spec
 * (`bulk-actions.queue.spec.ts`, Metacto ticket 076): two waiting in Review
 * with different lead magnets and recommended sequences, and one handed off,
 * which the page must show and never let anyone select.
 *
 * Idempotent: a rerun removes its own rows first, matched on the contact ref
 * prefix below. Fictional throughout (`libs/fixtures/realDataGuard.ts`).
 * Prints one JSON line, `{ orgId }`; everything else goes to stderr.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/queue/support/seed-bulk-leads.ts --email a@b.test
 */
import { parseArgs } from 'node:util';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, leadBriefSchema, projectSchema, userSchema } from '@/models/Schema';

const REF_PREFIX = 'contacts:e2e-bulk-';

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

async function main(): Promise<void> {
  if (!values.email) {
    console.error('pass --email <the signed-in admin>');
    process.exit(1);
  }
  const orgId = await orgOf(values.email);
  await db.delete(leadBriefSchema).where(and(eq(leadBriefSchema.orgId, orgId), like(leadBriefSchema.contactRef, `${REF_PREFIX}%`)));
  const briefedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await db.insert(leadBriefSchema).values([
    { orgId, contactRef: `${REF_PREFIX}1`, contactName: 'Wren Bulkfixture', companyName: 'Tideline Studio', triggerType: 'mql', status: 'ready_for_review', briefedAt, recommendedSequence: { id: 'e2e-seq-5', name: 'Personalized Nurture · 4 Assertive v2' } },
    { orgId, contactRef: `${REF_PREFIX}2`, contactName: 'Ossie Bulkfixture', companyName: 'Quarry Lane', triggerType: 'mql', status: 'ready_for_review', briefedAt, recommendedSequence: { id: 'e2e-seq-1', name: 'Personalized Nurture · 1 Ambient v2' } },
    { orgId, contactRef: `${REF_PREFIX}3`, contactName: 'Pim Bulkfixture', companyName: 'Harbor Row', triggerType: 'mql', status: 'handed_off', briefedAt },
  ]);
  process.stdout.write(`${JSON.stringify({ orgId })}\n`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
