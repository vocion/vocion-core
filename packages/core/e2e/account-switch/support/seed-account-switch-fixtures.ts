#!/usr/bin/env tsx
/**
 * seed-account-switch-fixtures — real data for the account-switch E2E spec
 * (`e2e/account-switch/account-switch.spec.ts`, vocion-core#128).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - two tenant accounts, "E2E Switch First" and "E2E Switch Second"
 *   - one person who belongs to both, joined First earlier, so First is where
 *     a fresh browser lands
 *   - a `e2e-switch-home` workspace on First, and a `e2e-switch-shared`
 *     workspace on EACH account — the same slug twice, which is the case a
 *     slug alone cannot tell apart
 *   - one agent per workspace, because the switcher hides empty workspaces
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs and email below), so the project stays repeatable.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/account-switch/support/seed-account-switch-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const FIRST_ACCOUNT = { slug: 'e2e-switch-first', name: 'E2E Switch First' };
const SECOND_ACCOUNT = { slug: 'e2e-switch-second', name: 'E2E Switch Second' };
const PERSON = { email: 'switch-person@e2e.test', name: 'Switch Person', password: 'account-switch-e2e-pass-1' };

/**
 * Delete this script's own rows so a rerun starts clean: agents before their
 * workspaces, workspaces and memberships before their account, memberships
 * before the user (FK order).
 */
async function resetFixtures(): Promise<void> {
  const existingUsers = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, PERSON.email));
  const userIds = existingUsers.map(user => user.id);
  if (userIds.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, userIds));
    await db.delete(userSchema).where(inArray(userSchema.id, userIds));
  }
  const accounts = await db
    .select({ id: tenantAccountSchema.id })
    .from(tenantAccountSchema)
    .where(inArray(tenantAccountSchema.slug, [FIRST_ACCOUNT.slug, SECOND_ACCOUNT.slug]));
  const accountIds = accounts.map(account => account.id);
  if (accountIds.length === 0) {
    return;
  }
  const projects = await db.select({ id: projectSchema.id }).from(projectSchema).where(inArray(projectSchema.accountId, accountIds));
  const projectIds = projects.map(project => project.id);
  if (projectIds.length > 0) {
    await db.delete(agentSchema).where(inArray(agentSchema.orgId, projectIds));
    await db.delete(projectSchema).where(inArray(projectSchema.id, projectIds));
  }
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, accountIds));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accountIds));
}

async function main(): Promise<void> {
  await resetFixtures();

  const runTag = Date.now().toString(36);
  const firstId = `acct-e2e-switch-first-${runTag}`;
  const secondId = `acct-e2e-switch-second-${runTag}`;
  const userId = `usr-e2e-switch-${runTag}`;
  const passwordHash = await hashPassword(PERSON.password);

  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values([
      { id: firstId, name: FIRST_ACCOUNT.name, slug: FIRST_ACCOUNT.slug },
      { id: secondId, name: SECOND_ACCOUNT.name, slug: SECOND_ACCOUNT.slug },
    ]);
    await tx.insert(userSchema).values({ id: userId, name: PERSON.name, email: PERSON.email, passwordHash });
    // Joined First a year before Second: First is the default.
    await tx.insert(accountMembershipSchema).values([
      { accountId: firstId, userId, role: 'admin', createdAt: new Date('2025-01-01T00:00:00Z') },
      { accountId: secondId, userId, role: 'admin', createdAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    // `home` is First's oldest workspace, so it is where a fresh sign-in lands.
    await tx.insert(projectSchema).values([
      { id: `proj-e2e-switch-home-${runTag}`, accountId: firstId, slug: 'e2e-switch-home', name: 'Switch Home', createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: `proj-e2e-switch-shared-first-${runTag}`, accountId: firstId, slug: 'e2e-switch-shared', name: 'Shared In First' },
      { id: `proj-e2e-switch-shared-second-${runTag}`, accountId: secondId, slug: 'e2e-switch-shared', name: 'Shared In Second' },
    ]);
    await tx.insert(agentSchema).values([
      { orgId: `proj-e2e-switch-home-${runTag}`, slug: 'e2e-switch-agent', name: 'E2E Switch Agent', systemPrompt: 'e2e account-switch fixture' },
      { orgId: `proj-e2e-switch-shared-first-${runTag}`, slug: 'e2e-switch-agent', name: 'E2E Switch Agent', systemPrompt: 'e2e account-switch fixture' },
      { orgId: `proj-e2e-switch-shared-second-${runTag}`, slug: 'e2e-switch-agent', name: 'E2E Switch Agent', systemPrompt: 'e2e account-switch fixture' },
    ]);
  });
  console.error(`[seed-account-switch-fixtures] person: ${userId}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-account-switch-fixtures] failed', error);
    process.exit(1);
  });
