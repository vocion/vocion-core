#!/usr/bin/env tsx
/**
 * seed-approved-by-agent-fixtures — real data for the approval-actor E2E spec
 * (`e2e/reviews-approved-by-agent/approved-by-agent.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own tenant account + project, so the spec never competes with
 *     whatever else lives in the developer's database — the other review
 *     projects use their own slugs for the same reason
 *   - a tenant API token for that project with the `owner` role, which holds
 *     the capabilities the propose and decide routes check for
 *   - an ENABLED trust rule on `qc.hold`, which is what lets the trust ladder
 *     release a confident proposal without a person. `qc.hold` is used rather
 *     than the event-candidate action on purpose: `objects.propose_candidate`
 *     sits on the never-auto guard list in ActionService and can never be
 *     auto-approved, so it cannot exercise the `true` state at all.
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs below), so the project stays repeatable against one database.
 *
 * Prints one JSON line to stdout — what the spec needs — after every other
 * message on this run went to stderr via console.error.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/reviews-approved-by-agent/support/seed-approved-by-agent-fixtures.ts
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  actionRunSchema,
  projectSchema,
  tenantAccountSchema,
  trustRuleSchema,
} from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-approved-by-agent';
const PROJECT_SLUG = 'e2e-approved-by-agent';
const TOKEN_NAME = 'e2e approved by agent';

/** The action the trust rule releases, and the confidence bar it has to clear. */
export const TRUSTED_ACTION_ID = 'qc.hold';
const TRUST_THRESHOLD = 0.8;

/**
 * Delete this script's own rows so a rerun starts clean. Order matters: every
 * row scoped to the project goes before the project, and the project before
 * the account it belongs to (FK `project.account_id`).
 */
async function resetFixtures(): Promise<void> {
  const [existing] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.slug, PROJECT_SLUG))
    .limit(1);
  if (existing) {
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, existing.id));
    await db.delete(trustRuleSchema).where(eq(trustRuleSchema.orgId, existing.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

async function createProject(): Promise<string> {
  const accountId = `acct-e2e-approved-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E Approved By Agent',
    slug: ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-approved-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: PROJECT_SLUG,
    name: 'E2E Approved By Agent',
  });
  return projectId;
}

async function main(): Promise<void> {
  await resetFixtures();

  const orgId = await createProject();
  console.error(`[seed-approved-by-agent-fixtures] project: ${orgId}`);

  // Enabled, so a proposal above the threshold auto-executes. Without this the
  // ladder returns `no-rule` and every proposal waits for a person, which is
  // the default and the safe one.
  await db.insert(trustRuleSchema).values({
    orgId,
    actionId: TRUSTED_ACTION_ID,
    threshold: TRUST_THRESHOLD,
    enabled: 'true',
  });
  console.error(`[seed-approved-by-agent-fixtures] trust rule: ${TRUSTED_ACTION_ID} >= ${TRUST_THRESHOLD}`);

  const issued = await issueToken({
    orgId,
    name: TOKEN_NAME,
    createdBy: 'e2e',
    // `owner` carries `*`, which covers the grant these actions require and
    // the `approve` capability the propose and decide routes check for.
    role: 'owner',
  });

  // The one stdout line the spec parses. Everything above went to stderr via
  // console.error, so this is the last thing on stdout. Written with
  // process.stdout.write rather than console.log because the repo's eslint
  // config only allows console.warn/console.error, and console.warn writes to
  // stderr in Node — it would not reach the spec's stdout capture.
  process.stdout.write(`${JSON.stringify({ orgId, token: issued.token })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-approved-by-agent-fixtures] failed', error);
    process.exit(1);
  });
