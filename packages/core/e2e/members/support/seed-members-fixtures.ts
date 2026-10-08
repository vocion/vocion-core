#!/usr/bin/env tsx
/**
 * seed-members-fixtures — real data for the Members invites E2E spec
 * (`e2e/members/members-invites.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own Org, "E2E Members", with one workspace and one agent (the
 *     switcher hides empty workspaces), so the spec never competes with
 *     whatever else lives in the developer's database
 *   - an admin who can sign in, and a member colleague
 *   - two invites the admin sent that nobody has accepted: one open, one
 *     expired
 *   - a second Org, "E2E Members Elsewhere", with an open invite of its own,
 *     which the first Org's Members page must never show
 *
 * Nobody here is in two Orgs, so it runs on a default single-Org server.
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs and emails below), so the project stays repeatable.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/members/support/seed-members-fixtures.ts
 */
import process from 'node:process';
import { inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const ORG = { slug: 'e2e-members', name: 'E2E Members' };
const ELSEWHERE = { slug: 'e2e-members-elsewhere', name: 'E2E Members Elsewhere' };
const ADMIN = { email: 'members-admin@e2e-members.example', name: 'Members Admin', password: 'members-e2e-pass-1' };
const COLLEAGUE = { email: 'members-colleague@e2e-members.example', name: 'Members Colleague' };
const OPEN_INVITE = 'casey@northwind.example';
const EXPIRED_INVITE = 'devon@northwind.example';
const ELSEWHERE_INVITE = 'erin@acme.example';
const DAY = 24 * 60 * 60 * 1000;

/**
 * Delete this script's own rows so a rerun starts clean: invites before the
 * admin who sent them, agents before their workspace, workspaces and
 * memberships before their Org, memberships before the user (FK order).
 */
async function resetFixtures(): Promise<void> {
  const orgs = await db
    .select({ id: tenantAccountSchema.id })
    .from(tenantAccountSchema)
    .where(inArray(tenantAccountSchema.slug, [ORG.slug, ELSEWHERE.slug]));
  const orgIds = orgs.map(o => o.id);
  if (orgIds.length > 0) {
    await db.delete(inviteSchema).where(inArray(inviteSchema.accountId, orgIds));
  }
  const users = await db
    .select({ id: userSchema.id })
    .from(userSchema)
    .where(inArray(userSchema.email, [ADMIN.email, COLLEAGUE.email]));
  const userIds = users.map(u => u.id);
  if (userIds.length > 0) {
    await db.delete(inviteSchema).where(inArray(inviteSchema.invitedBy, userIds));
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, userIds));
    await db.delete(userSchema).where(inArray(userSchema.id, userIds));
  }
  if (orgIds.length === 0) {
    return;
  }
  const projects = await db.select({ id: projectSchema.id }).from(projectSchema).where(inArray(projectSchema.accountId, orgIds));
  const projectIds = projects.map(p => p.id);
  if (projectIds.length > 0) {
    await db.delete(agentSchema).where(inArray(agentSchema.orgId, projectIds));
    await db.delete(projectSchema).where(inArray(projectSchema.id, projectIds));
  }
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, orgIds));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, orgIds));
}

async function main(): Promise<void> {
  await resetFixtures();

  const runTag = Date.now().toString(36);
  const orgId = `acct-e2e-members-${runTag}`;
  const elsewhereId = `acct-e2e-members-elsewhere-${runTag}`;
  const projectId = `proj-e2e-members-${runTag}`;
  const adminId = `usr-e2e-members-${runTag}`;
  const passwordHash = await hashPassword(ADMIN.password);

  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values([
      { id: orgId, name: ORG.name, slug: ORG.slug },
      { id: elsewhereId, name: ELSEWHERE.name, slug: ELSEWHERE.slug },
    ]);
    await tx.insert(userSchema).values([
      { id: adminId, name: ADMIN.name, email: ADMIN.email, passwordHash },
      { id: `${adminId}-colleague`, name: COLLEAGUE.name, email: COLLEAGUE.email },
    ]);
    await tx.insert(accountMembershipSchema).values([
      { accountId: orgId, userId: adminId, role: 'admin', createdAt: new Date(Date.now() - 30 * DAY) },
      { accountId: orgId, userId: `${adminId}-colleague`, role: 'member' },
    ]);
    await tx.insert(projectSchema).values({ id: projectId, accountId: orgId, slug: 'e2e-members-home', name: 'Members Home' });
    await tx.insert(agentSchema).values({ orgId: projectId, slug: 'e2e-members-agent', name: 'E2E Members Agent', systemPrompt: 'e2e members fixture' });
    await tx.insert(inviteSchema).values([
      {
        id: `inv-e2e-members-open-${runTag}`,
        accountId: orgId,
        email: OPEN_INVITE,
        role: 'member',
        token: `e2e-members-open-${runTag}`,
        invitedBy: adminId,
        expiresAt: new Date(Date.now() + 14 * DAY),
      },
      {
        id: `inv-e2e-members-expired-${runTag}`,
        accountId: orgId,
        email: EXPIRED_INVITE,
        role: 'admin',
        token: `e2e-members-expired-${runTag}`,
        invitedBy: adminId,
        createdAt: new Date(Date.now() - 15 * DAY),
        expiresAt: new Date(Date.now() - DAY),
      },
      {
        id: `inv-e2e-members-elsewhere-${runTag}`,
        accountId: elsewhereId,
        email: ELSEWHERE_INVITE,
        role: 'member',
        token: `e2e-members-elsewhere-${runTag}`,
        expiresAt: new Date(Date.now() + 14 * DAY),
      },
    ]);
  });
  console.error(`[seed-members-fixtures] admin: ${adminId}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-members-fixtures] failed', error);
    process.exit(1);
  });
