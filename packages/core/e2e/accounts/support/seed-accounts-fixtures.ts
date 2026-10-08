#!/usr/bin/env tsx
/**
 * seed-accounts-fixtures — the Orgs, people and invites `e2e/accounts`
 * starts from.
 *
 * - **E2E Accounts Northwind**, with two shared workspaces (Accounts Deals,
 *   Accounts Support) and an admin with a password, who invites people
 *   through the Members page in the spec itself.
 * - An invite for an address with no login (`accounts-ole@…`), accepted in the
 *   spec by a simulated Google sign-in.
 * - An expired invite (`accounts-late@…`), which every way in must refuse.
 * - **E2E Accounts Kestrel**, with one shared workspace, and an invite from it
 *   to Pat, who already has a login in Northwind: on a multi-Org server Pat's
 *   next sign-in joins it.
 * - **E2E Accounts Contoso**, with one shared workspace and its own admin, who
 *   invites Ida (a Northwind member, signed in) from Members in the spec: Ida
 *   hears it in the app and joins from her profile in one click.
 *
 * Idempotent: a rerun deletes this script's own rows first (by the fixed
 * slugs and the `accounts-` addresses below).
 *
 * Usage: npx dotenv -c -- npx tsx e2e/accounts/support/seed-accounts-fixtures.ts
 */
import process from 'node:process';
import { inArray, like, or } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

// Must match the spec.
const NORTHWIND = { slug: 'e2e-accounts-northwind', name: 'E2E Accounts Northwind' };
const KESTREL = { slug: 'e2e-accounts-kestrel', name: 'E2E Accounts Kestrel' };
const CONTOSO = { slug: 'e2e-accounts-contoso', name: 'E2E Accounts Contoso' };
const ADMIN = { email: 'accounts-admin@northwind.example', name: 'Ada Admin', password: 'accounts-e2e-admin-pass-1' };
const PAT = { email: 'accounts-pat@northwind.example', name: 'Pat Existing', password: 'accounts-e2e-pat-pass-1' };
const IDA = { email: 'accounts-ida@northwind.example', name: 'Ida Inside', password: 'accounts-e2e-ida-pass-1' };
const CARA = { email: 'accounts-cara@northwind.example', name: 'Cara Contoso', password: 'accounts-e2e-cara-pass-1' };
const OLE = 'accounts-ole@northwind.example';
const LATE = 'accounts-late@northwind.example';
// Fixed and public on purpose: throwaway invites in a test database.
const LATE_TOKEN = 'e2e-accounts-expired-invite-token';
const KESTREL_TOKEN = 'e2e-accounts-kestrel-invite-token';

async function resetFixtures(): Promise<void> {
  const users = await db.select({ id: userSchema.id }).from(userSchema).where(like(userSchema.email, 'accounts-%@northwind.example'));
  const userIds = users.map(u => u.id);
  const orgs = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(inArray(tenantAccountSchema.slug, [NORTHWIND.slug, KESTREL.slug, CONTOSO.slug]));
  const orgIds = orgs.map(o => o.id);
  if (orgIds.length > 0) {
    await db.delete(inviteSchema).where(inArray(inviteSchema.accountId, orgIds));
  }
  await db.delete(inviteSchema).where(like(inviteSchema.email, 'accounts-%@northwind.example'));
  if (userIds.length > 0 || orgIds.length > 0) {
    await db.delete(accountMembershipSchema).where(or(
      userIds.length > 0 ? inArray(accountMembershipSchema.userId, userIds) : undefined,
      orgIds.length > 0 ? inArray(accountMembershipSchema.accountId, orgIds) : undefined,
    ));
  }
  if (orgIds.length > 0) {
    // Personal workspaces made at sign-in live on these Orgs too.
    await db.delete(projectSchema).where(inArray(projectSchema.accountId, orgIds));
    await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, orgIds));
  }
  if (userIds.length > 0) {
    await db.delete(userSchema).where(inArray(userSchema.id, userIds));
  }
}

async function main(): Promise<void> {
  await resetFixtures();
  const run = Date.now().toString(36);
  const northwindId = `acct-e2e-accounts-n-${run}`;
  const kestrelId = `acct-e2e-accounts-k-${run}`;
  const contosoId = `acct-e2e-accounts-c-${run}`;
  const adminId = `usr-e2e-accounts-admin-${run}`;
  const patId = `usr-e2e-accounts-pat-${run}`;
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values([
      { id: northwindId, name: NORTHWIND.name, slug: NORTHWIND.slug },
      { id: kestrelId, name: KESTREL.name, slug: KESTREL.slug },
      { id: contosoId, name: CONTOSO.name, slug: CONTOSO.slug },
    ]);
    await tx.insert(projectSchema).values([
      { id: `proj-e2e-accounts-deals-${run}`, accountId: northwindId, slug: 'e2e-accounts-deals', name: 'Accounts Deals' },
      { id: `proj-e2e-accounts-support-${run}`, accountId: northwindId, slug: 'e2e-accounts-support', name: 'Accounts Support' },
      { id: `proj-e2e-accounts-desk-${run}`, accountId: kestrelId, slug: 'e2e-accounts-kestrel-desk', name: 'Kestrel Desk' },
      { id: `proj-e2e-accounts-contoso-${run}`, accountId: contosoId, slug: 'e2e-accounts-contoso-desk', name: 'Contoso Desk' },
    ]);
    await tx.insert(userSchema).values([
      { id: adminId, name: ADMIN.name, email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password) },
      { id: patId, name: PAT.name, email: PAT.email, passwordHash: await hashPassword(PAT.password) },
      { id: `usr-e2e-accounts-ida-${run}`, name: IDA.name, email: IDA.email, passwordHash: await hashPassword(IDA.password) },
      { id: `usr-e2e-accounts-cara-${run}`, name: CARA.name, email: CARA.email, passwordHash: await hashPassword(CARA.password) },
    ]);
    await tx.insert(accountMembershipSchema).values([
      { accountId: northwindId, userId: adminId, role: 'admin' },
      { accountId: northwindId, userId: patId, role: 'member' },
      { accountId: northwindId, userId: `usr-e2e-accounts-ida-${run}`, role: 'member' },
      { accountId: contosoId, userId: `usr-e2e-accounts-cara-${run}`, role: 'admin' },
    ]);
    await tx.insert(inviteSchema).values([
      { id: `inv-e2e-accounts-ole-${run}`, accountId: northwindId, email: OLE, role: 'member', token: `e2e-accounts-ole-${run}`, invitedBy: adminId, expiresAt: inTwoWeeks },
      { id: `inv-e2e-accounts-late-${run}`, accountId: northwindId, email: LATE, role: 'member', token: LATE_TOKEN, invitedBy: adminId, expiresAt: new Date(Date.now() - 86_400_000) },
      { id: `inv-e2e-accounts-pat-${run}`, accountId: kestrelId, email: PAT.email, role: 'member', token: KESTREL_TOKEN, expiresAt: inTwoWeeks },
    ]);
  });
  console.error('[seed-accounts-fixtures] seeded');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-accounts-fixtures] failed', error);
    process.exit(1);
  });
