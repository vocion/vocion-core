#!/usr/bin/env tsx
/**
 * seed-two-step-fixtures — two people for the sign-in E2E spec
 * (`e2e/two-step/two-step-sign-in.spec.ts`).
 *
 * Builds, in the database the running app is pointed at, its own account and
 * workspace and two members with passwords: one with no second factor yet
 * (the spec sets it up through the profile page itself), and one holding a
 * live forgot-password link whose token the spec knows, since no mail leaves
 * a test run.
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slug and email below). Deleting the user cascades to their
 * authenticator and recovery codes, so every run starts with two-step off.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/two-step/support/seed-two-step-fixtures.ts
 */
import { createHash } from 'node:crypto';
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, passwordResetTokenSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const SLUG = 'e2e-two-step';
const PERSON = { email: 'two-step-person@e2e.test', name: 'Two Step Person', password: 'two-step-e2e-pass-1' };
const RESETTER = { email: 'reset-person@e2e.test', name: 'Reset Person', password: 'reset-e2e-old-pass-1' };
// Fixed and public on purpose: it opens one throwaway login in a test database.
const RESET_TOKEN = 'e2e-two-step-reset-token-not-a-secret';

async function resetFixtures(): Promise<void> {
  const users = await db.select({ id: userSchema.id }).from(userSchema).where(inArray(userSchema.email, [PERSON.email, RESETTER.email]));
  const userIds = users.map(user => user.id);
  if (userIds.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, userIds));
    await db.delete(userSchema).where(inArray(userSchema.id, userIds));
  }
  await db.delete(projectSchema).where(eq(projectSchema.slug, SLUG));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, SLUG));
}

async function main(): Promise<void> {
  await resetFixtures();
  const runTag = Date.now().toString(36);
  const accountId = `acct-e2e-two-step-${runTag}`;
  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values({ id: accountId, name: 'E2E Two Step', slug: SLUG });
    await tx.insert(projectSchema).values({ id: `proj-e2e-two-step-${runTag}`, accountId, slug: SLUG, name: 'E2E Two Step' });
    const userId = `usr-e2e-two-step-${runTag}`;
    await tx.insert(userSchema).values({ id: userId, name: PERSON.name, email: PERSON.email, passwordHash: await hashPassword(PERSON.password) });
    await tx.insert(accountMembershipSchema).values({ accountId, userId, role: 'admin' });
    const resetterId = `usr-e2e-reset-${runTag}`;
    await tx.insert(userSchema).values({ id: resetterId, name: RESETTER.name, email: RESETTER.email, passwordHash: await hashPassword(RESETTER.password) });
    await tx.insert(accountMembershipSchema).values({ accountId, userId: resetterId, role: 'member' });
    // Stored the way `services/auth/passwordReset.ts` stores one: the hash only.
    await tx.insert(passwordResetTokenSchema).values({
      id: `prt-e2e-${runTag}`,
      userId: resetterId,
      tokenHash: createHash('sha256').update(RESET_TOKEN).digest('hex'),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
  });
  console.error('[seed-two-step-fixtures] seeded');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-two-step-fixtures] failed', error);
    process.exit(1);
  });
