#!/usr/bin/env tsx
/**
 * seed-phone-drawer-fixtures — one person with more workspaces than the
 * picker shows at once, for `e2e/phone-drawer/phone-drawer.spec.ts`.
 *
 * Builds, in the database the running app is pointed at: one Org, one admin
 * who can sign in, a home workspace with an agent (where a fresh sign-in
 * lands), and eleven more workspaces so the picker's list has to scroll.
 * Fictional names only (`libs/fixtures/realDataGuard.ts`).
 *
 * Idempotent: a rerun deletes this script's own rows first.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/phone-drawer/support/seed-phone-drawer-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const ACCOUNT = { slug: 'e2e-phone-drawer', name: 'Northwind Phone' };
const PERSON = { email: 'phone-drawer@e2e.example', name: 'Pat Drawer', password: 'phone-drawer-e2e-pass-1' };
const OTHERS = ['Kestrel Capital', 'Larkfield Systems', 'Contoso Supply', 'Bellwater Hall', 'Acme Field', 'Harbor Desk', 'Juniper Ops', 'Maple Studio', 'Orchid Labs', 'Quarry Works', 'Sable Freight'];

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
    await db.delete(agentSchema).where(inArray(agentSchema.orgId, projects.map(p => p.id)));
    await db.delete(projectSchema).where(inArray(projectSchema.id, projects.map(p => p.id)));
  }
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, accountIds));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accountIds));
}

async function main(): Promise<void> {
  await resetFixtures();
  const tag = Date.now().toString(36);
  const accountId = `acct-e2e-phone-drawer-${tag}`;
  const userId = `usr-e2e-phone-drawer-${tag}`;
  const homeId = `proj-e2e-phone-home-${tag}`;
  const slug = (name: string) => `e2e-phone-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values({ id: accountId, name: ACCOUNT.name, slug: ACCOUNT.slug });
    await tx.insert(userSchema).values({ id: userId, name: PERSON.name, email: PERSON.email, passwordHash: await hashPassword(PERSON.password) });
    await tx.insert(accountMembershipSchema).values({ accountId, userId, role: 'admin' });
    await tx.insert(projectSchema).values([
      { id: homeId, accountId, slug: 'e2e-phone-home', name: 'Northwind', createdAt: new Date('2025-01-01T00:00:00Z') },
      ...OTHERS.map((name, i) => ({ id: `proj-${slug(name)}-${tag}`, accountId, slug: slug(name), name, createdAt: new Date(Date.UTC(2025, 1, 1 + i)) })),
    ]);
    await tx.insert(agentSchema).values({ orgId: homeId, slug: 'e2e-phone-agent', name: 'Phone Agent', systemPrompt: 'e2e phone-drawer fixture' });
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-phone-drawer-fixtures] failed', error);
    process.exit(1);
  });
