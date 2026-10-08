/**
 * A brand-new shared workspace in the admin's Org, made the way core makes
 * one: the row, then its workspace lead (`ensureWorkspaceLead`). Fresh on
 * every run, so the spec always meets a workspace on its first day however
 * many times it has run against the same database.
 *
 *   npx tsx e2e/onboarding/support/newWorkspace.ts <admin-email> <slug> <name>
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, userSchema } from '@/models/Schema';
import { ensureWorkspaceLead } from '@/services/workspace/workspaceLead';
import 'dotenv/config';

async function main() {
  const [email, slug, name] = process.argv.slice(2);
  if (!email || !slug || !name) {
    throw new Error('usage: newWorkspace.ts <admin-email> <slug> <name>');
  }
  const [admin] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, and(eq(accountMembershipSchema.userId, userSchema.id), eq(accountMembershipSchema.role, 'admin')))
    .where(eq(userSchema.email, email.toLowerCase()))
    .limit(1);
  if (!admin) {
    throw new Error(`no admin ${email}`);
  }
  const id = `proj-${randomUUID()}`;
  await db.insert(projectSchema).values({ id, accountId: admin.accountId, slug, name });
  await ensureWorkspaceLead(id);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
