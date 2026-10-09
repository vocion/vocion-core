#!/usr/bin/env tsx
/**
 * seed-pins-fixtures — one person in two workspaces, with things to pin, for
 * `e2e/pins/pins.spec.ts`.
 *
 * Builds, in the database the running app is pointed at: one Org, one admin
 * who can sign in, a Northwind workspace holding a conversation, a doc and a
 * data room, and an empty Kestrel workspace (pins are per workspace).
 * Fictional names only (`libs/fixtures/realDataGuard.ts`). Prints the ids as
 * JSON on its last line.
 *
 * Idempotent: a rerun deletes this script's own rows first.
 * `--delete-conversation <id>` deletes one conversation instead, so the spec
 * can show a pinned target that was deleted.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/pins/support/seed-pins-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  agentSchema,
  artifactSchema,
  businessObjectSchema,
  businessObjectTypeSchema,
  conversationSchema,
  projectSchema,
  tenantAccountSchema,
  userNavPrefSchema,
  userSchema,
} from '@/models/Schema';
import 'dotenv/config';

const ACCOUNT = { slug: 'e2e-pins', name: 'Northwind Pins' };
const PERSON = { email: 'pins@e2e.example', name: 'Pat Pinner', password: 'pins-e2e-pass-1' };

async function resetFixtures(): Promise<void> {
  const users = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, PERSON.email));
  if (users.length > 0) {
    const ids = users.map(u => u.id);
    await db.delete(userNavPrefSchema).where(inArray(userNavPrefSchema.userId, ids));
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, ids));
    // Their Personal workspace, made at sign-in, goes with them.
    await db.delete(projectSchema).where(inArray(projectSchema.ownerUserId, ids));
    await db.delete(userSchema).where(inArray(userSchema.id, ids));
  }
  const accounts = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT.slug));
  if (accounts.length === 0) {
    return;
  }
  const accountIds = accounts.map(a => a.id);
  const projects = await db.select({ id: projectSchema.id }).from(projectSchema).where(inArray(projectSchema.accountId, accountIds));
  if (projects.length > 0) {
    const orgIds = projects.map(p => p.id);
    await db.delete(artifactSchema).where(inArray(artifactSchema.orgId, orgIds));
    await db.delete(conversationSchema).where(inArray(conversationSchema.orgId, orgIds));
    await db.delete(businessObjectTypeSchema).where(inArray(businessObjectTypeSchema.orgId, orgIds));
    await db.delete(agentSchema).where(inArray(agentSchema.orgId, orgIds));
    await db.delete(projectSchema).where(inArray(projectSchema.id, orgIds));
  }
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, accountIds));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accountIds));
}

async function seed(): Promise<Record<string, number>> {
  await resetFixtures();
  const tag = Date.now().toString(36);
  const accountId = `acct-e2e-pins-${tag}`;
  const userId = `usr-e2e-pins-${tag}`;
  const northwind = `proj-e2e-pins-northwind-${tag}`;
  const kestrel = `proj-e2e-pins-kestrel-${tag}`;
  return db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values({ id: accountId, name: ACCOUNT.name, slug: ACCOUNT.slug });
    await tx.insert(userSchema).values({ id: userId, name: PERSON.name, email: PERSON.email, passwordHash: await hashPassword(PERSON.password) });
    await tx.insert(accountMembershipSchema).values({ accountId, userId, role: 'admin' });
    await tx.insert(projectSchema).values([
      { id: northwind, accountId, slug: 'e2e-pins-northwind', name: 'Northwind', createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: kestrel, accountId, slug: 'e2e-pins-kestrel', name: 'Kestrel Ops', createdAt: new Date('2025-02-01T00:00:00Z') },
    ]);
    await tx.insert(agentSchema).values([
      { orgId: northwind, slug: 'e2e-pins-agent', name: 'Pins Agent', systemPrompt: 'e2e pins fixture' },
      { orgId: kestrel, slug: 'e2e-pins-agent', name: 'Pins Agent', systemPrompt: 'e2e pins fixture' },
    ]);
    const [chat] = await tx.insert(conversationSchema).values({ orgId: northwind, projectId: northwind, agentSlug: 'e2e-pins-agent', title: 'Northwind renewal plan', createdBy: userId }).returning({ id: conversationSchema.id });
    const [doc] = await tx.insert(artifactSchema).values({ orgId: northwind, projectId: northwind, kind: 'markdown', title: 'Contoso supply pricing memo', spec: { md: '# Pricing\n\nA fictional memo.' } }).returning({ id: artifactSchema.id });
    const [type] = await tx.insert(businessObjectTypeSchema).values({ orgId: northwind, slug: 'data_room', label: 'Data room' }).returning({ id: businessObjectTypeSchema.id });
    const [room] = await tx.insert(businessObjectSchema).values({ orgId: northwind, projectId: northwind, typeId: type!.id, title: 'Larkfield Systems diligence', metadata: { client: 'Larkfield Systems' } }).returning({ id: businessObjectSchema.id });
    return { conversation: chat!.id, artifact: doc!.id, room: room!.id };
  });
}

async function main(): Promise<void> {
  const at = process.argv.indexOf('--delete-conversation');
  if (at !== -1) {
    await db.delete(conversationSchema).where(eq(conversationSchema.id, Number(process.argv[at + 1])));
    return;
  }
  process.stdout.write(`${JSON.stringify(await seed())}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-pins-fixtures] failed', error);
    process.exit(1);
  });
