#!/usr/bin/env tsx
/**
 * seed-propose-fixtures — real data for the VEERIO-262 propose-outcome E2E
 * spec (`e2e/reviews-propose/propose-outcomes.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own tenant account + project, so the spec never competes with
 *     whatever else lives in the developer's database
 *   - the `candidate-intake` demo workspace applied to that project, which
 *     is where the `event_candidate` object type comes from. Without it
 *     `objects.propose_candidate` refuses every proposal in its precheck.
 *   - a tenant API token for that project, minted through the same
 *     `issueToken` the dashboard's "Create token" button calls, with the
 *     `owner` role so it holds the `approve` capability both the propose
 *     and the decide route require.
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs below), so `npx playwright test --project=reviews-propose`
 * stays repeatable against the same database.
 *
 * Prints one JSON line to stdout — what the spec needs — after every other
 * message on this run went to stderr via console.error.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/reviews-propose/support/seed-propose-fixtures.ts
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

const ACCOUNT_SLUG = 'e2e-propose-outcomes';
const PROJECT_SLUG = 'e2e-propose-outcomes';
const TOKEN_NAME = 'e2e propose outcomes';
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
  const accountId = `acct-e2e-propose-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E Propose Outcomes',
    slug: ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-propose-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: PROJECT_SLUG,
    name: 'E2E Propose Outcomes',
  });
  return projectId;
}

async function main(): Promise<void> {
  await resetFixtures();

  const orgId = await createProject();
  console.error(`[seed-propose-fixtures] project: ${orgId}`);

  const applied = await applyWorkspace(loadWorkspace(WORKSPACE_PATH), { orgId });
  if (applied.errors.length > 0) {
    throw new Error(`workspace apply failed: ${applied.errors.join('; ')}`);
  }
  console.error(`[seed-propose-fixtures] object types created: ${applied.counts.objectTypes.created}`);

  const issued = await issueToken({
    orgId,
    name: TOKEN_NAME,
    createdBy: 'e2e',
    // `owner` carries `*`, which is what the propose and decide routes check
    // for when they enforce the `approve` capability.
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
    console.error('[seed-propose-fixtures] failed', error);
    process.exit(1);
  });
