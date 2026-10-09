#!/usr/bin/env tsx
/**
 * seed-all-workspaces-fixtures — the shapes the All workspaces page has to
 * order, for `e2e/all-workspaces/all-workspaces.spec.ts`.
 *
 * One Org, one admin who can sign in, and:
 *   - Northwind: the busiest, with a lead, seven agents and a conversation an hour ago
 *   - Kestrel Ops: two agents, last active three days ago, one open ask (a badge)
 *   - Bellwater Hall: empty (no agents, no activity)
 *   - a legacy placeholder named the way migration 0022 named them,
 *     "Project proj-…", created first and empty: it must never outrank a real one,
 *     and never show that raw id as its name
 *   - Old Pilot: archived, behind "Show archived"
 * plus the Personal workspace the person gets at sign-in.
 * Fictional names only (`libs/fixtures/realDataGuard.ts`).
 *
 * Idempotent: a rerun deletes this script's own rows first.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/all-workspaces/support/seed-all-workspaces-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, askSchema, conversationSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const ACCOUNT = { slug: 'e2e-all-workspaces', name: 'Northwind Trading' };
const PERSON = { email: 'all-workspaces@e2e.example', name: 'Robin Vale', password: 'all-workspaces-e2e-pass-1' };

async function resetFixtures(): Promise<void> {
  const users = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, PERSON.email));
  const accounts = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT.slug));
  const accountIds = accounts.map(a => a.id);
  const projects = accountIds.length > 0 ? await db.select({ id: projectSchema.id }).from(projectSchema).where(inArray(projectSchema.accountId, accountIds)) : [];
  const projectIds = projects.map(p => p.id);
  if (projectIds.length > 0) {
    await db.delete(askSchema).where(inArray(askSchema.orgId, projectIds));
    await db.delete(conversationSchema).where(inArray(conversationSchema.orgId, projectIds));
    await db.delete(agentSchema).where(inArray(agentSchema.orgId, projectIds));
    await db.delete(projectSchema).where(inArray(projectSchema.id, projectIds));
  }
  if (users.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, users.map(u => u.id)));
    await db.delete(userSchema).where(inArray(userSchema.id, users.map(u => u.id)));
  }
  if (accountIds.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, accountIds));
    await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accountIds));
  }
}

async function main(): Promise<void> {
  await resetFixtures();
  const tag = Date.now().toString(36);
  const accountId = `acct-e2e-all-workspaces-${tag}`;
  const userId = `usr-e2e-all-workspaces-${tag}`;
  const ids = {
    northwind: `proj-e2e-allws-northwind-${tag}`,
    kestrel: `proj-e2e-allws-kestrel-${tag}`,
    bellwater: `proj-e2e-allws-bellwater-${tag}`,
    ghost: `proj-proj-northwind-0a1b2c3d4e5f60718293a4b5c6d7e8f9-${tag}`,
    pilot: `proj-e2e-allws-pilot-${tag}`,
  };
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values({ id: accountId, name: ACCOUNT.name, slug: ACCOUNT.slug });
    await tx.insert(userSchema).values({ id: userId, name: PERSON.name, email: PERSON.email, passwordHash: await hashPassword(PERSON.password) });
    await tx.insert(accountMembershipSchema).values({ accountId, userId, role: 'admin' });
    await tx.insert(projectSchema).values([
      // The placeholder is the oldest, as the real ones were: age must not rank it first.
      { id: ids.ghost, accountId, slug: `org-proj-northwind-0a1b2c3d4e5f-${tag}`, name: 'Project proj-northwind-0a1b2c3d4e5f60718293a4b5c6d7e8f9', createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: ids.northwind, accountId, slug: 'e2e-allws-northwind', name: 'Northwind', leadAgentSlug: 'atlas', createdAt: new Date('2025-02-01T00:00:00Z') },
      { id: ids.kestrel, accountId, slug: 'e2e-allws-kestrel', name: 'Kestrel Ops', createdAt: new Date('2025-03-01T00:00:00Z') },
      { id: ids.bellwater, accountId, slug: 'e2e-allws-bellwater', name: 'Bellwater Hall', createdAt: new Date('2025-04-01T00:00:00Z') },
      { id: ids.pilot, accountId, slug: 'e2e-allws-pilot', name: 'Old Pilot', archivedAt: new Date('2025-06-01T00:00:00Z'), createdAt: new Date('2025-05-01T00:00:00Z') },
    ]);
    const agent = (orgId: string, slug: string, name: string) => ({ orgId, slug, name, systemPrompt: 'e2e all-workspaces fixture' });
    await tx.insert(agentSchema).values([
      agent(ids.northwind, 'atlas', 'Atlas'),
      ...['scout', 'ledger', 'herald', 'quill', 'tally', 'beacon'].map(s => agent(ids.northwind, s, s[0]!.toUpperCase() + s.slice(1))),
      agent(ids.kestrel, 'ops-lead', 'Ops Lead'),
      agent(ids.kestrel, 'dispatcher', 'Dispatcher'),
    ]);
    await tx.insert(conversationSchema).values([
      { orgId: ids.northwind, projectId: ids.northwind, agentSlug: 'atlas', title: 'Weekly pipeline', createdAt: hourAgo, updatedAt: hourAgo },
      { orgId: ids.kestrel, projectId: ids.kestrel, agentSlug: 'ops-lead', title: 'Carrier rates', createdAt: threeDaysAgo, updatedAt: threeDaysAgo },
    ]);
    await tx.insert(askSchema).values({ orgId: ids.kestrel, projectId: ids.kestrel, kind: 'approval', title: 'Approve the new carrier rate card', risk: 'medium', agentSlug: 'ops-lead', createdBy: userId });
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-all-workspaces-fixtures] failed', error);
    process.exit(1);
  });
