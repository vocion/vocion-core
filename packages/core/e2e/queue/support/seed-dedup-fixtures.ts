#!/usr/bin/env tsx
/**
 * seed-dedup-fixtures. Real data for the VEERIO-257 dedupOn E2E spec
 * (`e2e/queue/objects-propose-candidate-dedup-required.queue.spec.ts`).
 *
 * Two modes, both against the database the running app is pointed at:
 *
 *   (default)          Builds the spec's own tenant account + project
 *                      ("e2e-dedup-required") and mints a tenant API token
 *                      for it through `issueToken`, the same function
 *                      `npm run tokens:issue` and the dashboard's "Create
 *                      token" button call, with the `owner` role so it holds
 *                      the `approve` capability the propose route checks.
 *                      The spec registers its own object type over the API,
 *                      so no workspace is applied here. Prints one JSON line
 *                      to stdout: `{ orgId, token }`.
 *
 *   --count "<sql>"    Runs one `select count(*) ...` statement and prints
 *                      the number alone on stdout. This replaces the
 *                      `docker exec vocion-postgres psql` the spec used to
 *                      shell out to: CI has no docker daemon and its database
 *                      is an in-memory PGlite, and a developer's may be
 *                      either. Reading through the app's own database client
 *                      keeps the point of the check, which is that a row the
 *                      API forgot to report still shows up.
 *
 * Idempotent: a rerun deletes this script's own rows first (matched by the
 * fixed slugs below), so `npx playwright test --project=queue` stays
 * repeatable against the same database.
 *
 * Everything that is not the answer goes to stderr via console.error, so the
 * last stdout line is always the one the spec parses.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/queue/support/seed-dedup-fixtures.ts
 *   npx dotenv -c -- npx tsx e2e/queue/support/seed-dedup-fixtures.ts --count "select count(*) from action_run"
 */
import process from 'node:process';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  actionRunSchema,
  businessObjectSchema,
  businessObjectTypeSchema,
  projectSchema,
  tenantAccountSchema,
} from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-dedup-required';
const PROJECT_SLUG = 'e2e-dedup-required';
const TOKEN_NAME = 'e2e dedupOn required';

/**
 * Delete this script's own rows so a rerun starts clean. Every row scoped to
 * the project goes before the project, and the project before the account it
 * belongs to (FK `project.account_id`). Tokens carry `org_id` without a
 * foreign key, so an earlier run's token is left behind and simply stops
 * resolving to a project.
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
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

async function createProject(): Promise<string> {
  const accountId = `acct-e2e-dedup-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E dedupOn Required',
    slug: ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-dedup-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: PROJECT_SLUG,
    name: 'E2E dedupOn Required',
  });
  return projectId;
}

async function seed(): Promise<void> {
  await resetFixtures();

  const orgId = await createProject();
  console.error(`[seed-dedup-fixtures] project: ${orgId}`);

  const issued = await issueToken({
    orgId,
    name: TOKEN_NAME,
    createdBy: 'e2e',
    role: 'owner',
  });

  // Written with process.stdout.write rather than console.log because the
  // repo's eslint config only allows console.warn/console.error, and
  // console.warn writes to stderr in Node, where the spec is not looking.
  process.stdout.write(`${JSON.stringify({ orgId, token: issued.token })}\n`);
}

async function count(statement: string): Promise<void> {
  const result = await db.execute(sql.raw(statement));
  const [row] = result.rows as Array<Record<string, unknown>>;
  const value = row ? Object.values(row)[0] : undefined;
  if (value === undefined) {
    throw new Error(`count returned no row for: ${statement}`);
  }
  process.stdout.write(`${Number(value)}\n`);
}

async function main(): Promise<void> {
  const countAt = process.argv.indexOf('--count');
  if (countAt === -1) {
    await seed();
    return;
  }
  const statement = process.argv[countAt + 1];
  if (!statement) {
    throw new Error('--count needs a SQL statement');
  }
  await count(statement);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-dedup-fixtures] failed', error);
    process.exit(1);
  });
