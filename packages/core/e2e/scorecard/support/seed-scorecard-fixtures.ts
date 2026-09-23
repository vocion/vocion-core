#!/usr/bin/env tsx
/**
 * seed-scorecard-fixtures — real data for the agent scorecard E2E spec
 * (`e2e/scorecard/scorecard-member.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own tenant account + project, so the spec never competes with
 *     whatever else lives in the developer's database
 *   - a MEMBER (not admin) user in that account — the whole point of #342 is
 *     that a non-admin can open the scorecard
 *   - two agents: one with decided recommendations in the alignment ledger,
 *     one with none at all, which must render as "Not enough data"
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs and email below), so the project stays repeatable.
 *
 * Prints one JSON line to stdout — what the spec needs — after every other
 * message on this run went to stderr via console.error.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/scorecard/support/seed-scorecard-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  agentSchema,
  decisionAlignmentSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} from '@/models/Schema';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-scorecard';
const PROJECT_SLUG = 'e2e-scorecard';
const MEMBER = { email: 'scorecard-member@e2e.test', name: 'Scorecard Member', password: 'scorecard-e2e-pass-1' };
const DECIDED_AGENT = { slug: 'e2e-screener', name: 'E2E Applicant Screener' };
const UNDECIDED_AGENT = { slug: 'e2e-router', name: 'E2E Store Router' };

/**
 * Delete this script's own rows so a rerun starts clean. Every row scoped to
 * the project goes before the project, the project before its account, and
 * the membership before the user and the account (FK order).
 */
async function resetFixtures(): Promise<void> {
  const existingUsers = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, MEMBER.email));
  const userIds = existingUsers.map(user => user.id);
  if (userIds.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, userIds));
    await db.delete(userSchema).where(inArray(userSchema.id, userIds));
  }
  const [existingProject] = await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.slug, PROJECT_SLUG)).limit(1);
  if (existingProject) {
    await db.delete(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, existingProject.id));
    await db.delete(agentSchema).where(eq(agentSchema.orgId, existingProject.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existingProject.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

async function main(): Promise<void> {
  await resetFixtures();

  const runTag = Date.now().toString(36);
  const accountId = `acct-e2e-scorecard-${runTag}`;
  const projectId = `proj-e2e-scorecard-${runTag}`;
  const userId = `usr-e2e-scorecard-${runTag}`;
  const passwordHash = await hashPassword(MEMBER.password);

  await db.transaction(async (tx) => {
    await tx.insert(tenantAccountSchema).values({ id: accountId, name: 'E2E Scorecard', slug: ACCOUNT_SLUG });
    await tx.insert(projectSchema).values({ id: projectId, accountId, slug: PROJECT_SLUG, name: 'E2E Scorecard' });
    await tx.insert(userSchema).values({ id: userId, name: MEMBER.name, email: MEMBER.email, passwordHash });
    await tx.insert(accountMembershipSchema).values({ accountId, userId, role: 'member' });
    await tx.insert(agentSchema).values([
      { orgId: projectId, slug: DECIDED_AGENT.slug, name: DECIDED_AGENT.name, systemPrompt: 'e2e scorecard fixture' },
      { orgId: projectId, slug: UNDECIDED_AGENT.slug, name: UNDECIDED_AGENT.name, systemPrompt: 'e2e scorecard fixture' },
    ]);
    // Three decided recommendations for the screener: two agreed, one overruled
    // → 67% agreement; confidences 0.9, 0.8, 0.7 → 80% average confidence.
    await tx.insert(decisionAlignmentSchema).values([
      { orgId: projectId, subjectKind: 'action', subjectKey: 'e2e.scorecard', subjectId: 1, agentSlug: DECIDED_AGENT.slug, decision: 'approved', recommended: 'approved', agreed: true, confidence: 0.9 },
      { orgId: projectId, subjectKind: 'action', subjectKey: 'e2e.scorecard', subjectId: 2, agentSlug: DECIDED_AGENT.slug, decision: 'approved', recommended: 'approved', agreed: true, confidence: 0.8 },
      { orgId: projectId, subjectKind: 'action', subjectKey: 'e2e.scorecard', subjectId: 3, agentSlug: DECIDED_AGENT.slug, decision: 'rejected', recommended: 'approved', agreed: false, confidence: 0.7 },
    ]);
  });
  console.error(`[seed-scorecard-fixtures] project: ${projectId}`);

  // The one stdout line the spec parses. Written with process.stdout.write
  // because the repo's eslint config allows only console.warn/console.error.
  process.stdout.write(`${JSON.stringify({ projectId })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-scorecard-fixtures] failed', error);
    process.exit(1);
  });
