#!/usr/bin/env tsx
/**
 * seed-suggested-decision-fixtures — real data for the recommendation-filter
 * E2E spec (`e2e/reviews-suggested-decision/suggested-decision-filter.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own tenant account + project, so the spec never competes with
 *     whatever else lives in the developer's database — including the
 *     `reviews-propose` fixtures, which use their own slugs for the same
 *     reason
 *   - the `candidate-intake` demo workspace applied to that project, which is
 *     where the `event_candidate` object type comes from. Without it
 *     `objects.propose_candidate` refuses every proposal in its precheck.
 *   - a tenant API token for that project with the `owner` role, which holds
 *     the `approve` capability the propose route requires.
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs below), so the project stays repeatable against one database.
 *
 * Prints one JSON line to stdout — what the spec needs — after every other
 * message on this run went to stderr via console.error.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/reviews-suggested-decision/support/seed-suggested-decision-fixtures.ts
 */
import { resolve } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { applyWorkspace } from '@/libs/workspace/applier';
import { loadWorkspace } from '@/libs/workspace/loader';
import {
  actionRunSchema,
  agentSchema,
  businessObjectSchema,
  businessObjectTypeSchema,
  playbookSchema,
  projectSchema,
  tenantAccountSchema,
} from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-suggested-decision';
const PROJECT_SLUG = 'e2e-suggested-decision';
const TOKEN_NAME = 'e2e suggested decision';
// Relative to the package root, because tsx runs this file as CJS and
// `import.meta.dirname` is undefined there. The usage line above runs it from
// `packages/core`, same as every other script in this repo.
const WORKSPACE_PATH = resolve(process.cwd(), 'demo/candidate-intake-workspace');

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
    await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, existing.id));
    await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, existing.id));
    await db.delete(playbookSchema).where(eq(playbookSchema.orgId, existing.id));
    await db.delete(agentSchema).where(eq(agentSchema.orgId, existing.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

async function createProject(): Promise<string> {
  const accountId = `acct-e2e-suggested-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E Suggested Decision',
    slug: ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-suggested-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: PROJECT_SLUG,
    name: 'E2E Suggested Decision',
  });
  return projectId;
}

async function main(): Promise<void> {
  await resetFixtures();

  const orgId = await createProject();
  console.error(`[seed-suggested-decision-fixtures] project: ${orgId}`);

  const applied = await applyWorkspace(loadWorkspace(WORKSPACE_PATH), { orgId });
  if (applied.errors.length > 0) {
    throw new Error(`workspace apply failed: ${applied.errors.join('; ')}`);
  }
  console.error(`[seed-suggested-decision-fixtures] object types created: ${applied.counts.objectTypes.created}`);

  const issued = await issueToken({
    orgId,
    name: TOKEN_NAME,
    createdBy: 'e2e',
    // `owner` carries `*`, which is what the propose route checks for when it
    // enforces the `approve` capability.
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
    console.error('[seed-suggested-decision-fixtures] failed', error);
    process.exit(1);
  });
