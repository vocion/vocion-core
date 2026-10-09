#!/usr/bin/env tsx
/**
 * seed-attachments-fixtures — one person in one workspace with an agent, for
 * `e2e/attachments/attachments.spec.ts`: enough for the chat page to boot and
 * take files. Fictional names only (`libs/fixtures/realDataGuard.ts`).
 *
 * Idempotent: a rerun deletes this script's own rows first.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/attachments/support/seed-attachments-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, artifactSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const ACCOUNT = { slug: 'e2e-attachments', name: 'Northwind Attach' };
const PERSON = { email: 'attachments@e2e.example', name: 'Sam Ito', password: 'attachments-e2e-pass-1' };
const HOME = { slug: 'e2e-attach-home', name: 'Northwind' };

async function resetFixtures(): Promise<void> {
  const users = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, PERSON.email));
  if (users.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, users.map(u => u.id)));
    await db.delete(userSchema).where(inArray(userSchema.id, users.map(u => u.id)));
  }
  const accounts = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT.slug));
  if (accounts.length === 0) {
    return;
  }
  const accountIds = accounts.map(a => a.id);
  const projects = await db.select({ id: projectSchema.id }).from(projectSchema).where(inArray(projectSchema.accountId, accountIds));
  if (projects.length > 0) {
    const ids = projects.map(p => p.id);
    await db.delete(artifactSchema).where(inArray(artifactSchema.orgId, ids));
    await db.delete(agentSchema).where(inArray(agentSchema.orgId, ids));
    await db.delete(projectSchema).where(inArray(projectSchema.id, ids));
  }
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, accountIds));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accountIds));
}

async function main(): Promise<void> {
  await resetFixtures();
  const tag = Date.now().toString(36);
  const accountId = `acct-e2e-attachments-${tag}`;
  const userId = `usr-e2e-attachments-${tag}`;
  const homeId = `proj-e2e-attach-home-${tag}`;
  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values({ id: accountId, name: ACCOUNT.name, slug: ACCOUNT.slug });
    await tx.insert(userSchema).values({ id: userId, name: PERSON.name, email: PERSON.email, passwordHash: await hashPassword(PERSON.password) });
    await tx.insert(accountMembershipSchema).values({ accountId, userId, role: 'admin' });
    await tx.insert(projectSchema).values({ id: homeId, accountId, slug: HOME.slug, name: HOME.name, createdAt: new Date('2025-01-01T00:00:00Z') });
    await tx.insert(agentSchema).values({ orgId: homeId, slug: 'e2e-attach-agent', name: 'Revenue Lead', systemPrompt: 'e2e attachments fixture' });
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-attachments-fixtures] failed', error);
    process.exit(1);
  });
