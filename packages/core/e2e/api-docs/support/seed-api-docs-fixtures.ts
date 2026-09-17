#!/usr/bin/env tsx
/**
 * seed-api-docs-fixtures — one tenant and one API token for the API reference
 * E2E spec (`e2e/api-docs/openapi-spec.spec.ts`).
 *
 * The spec needs a real credential and nothing else: it reads the published
 * OpenAPI document and then calls one of the endpoints the document describes,
 * to prove the two agree. So this builds the smallest thing that can hold a
 * token — a tenant account and a project — in the database the running app is
 * pointed at.
 *
 * The token is minted through `issueToken`, the same function the dashboard's
 * "Create token" button calls, so the spec drives the API the way a real
 * integration does.
 *
 * Idempotent: a rerun deletes its own fixture rows first, matched by the fixed
 * slugs below.
 *
 * Prints one JSON line to stdout; everything else goes to stderr.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/api-docs/support/seed-api-docs-fixtures.ts
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-api-docs';
const PROJECT_SLUG = 'e2e-api-docs';
const TOKEN_NAME = 'e2e-api-docs';

/** Remove this script's own rows so a rerun starts clean. */
async function clearFixtures(): Promise<void> {
  const [existing] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.slug, PROJECT_SLUG))
    .limit(1);
  if (existing) {
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

/**
 * The project the token belongs to. Created rather than looked up: CI runs
 * against an empty in-memory database, so there is nothing to find.
 */
async function createProject(): Promise<string> {
  const accountId = `acct-e2e-api-docs-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E API docs',
    slug: ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-api-docs-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: PROJECT_SLUG,
    name: 'E2E API docs',
  });
  return projectId;
}

async function main(): Promise<void> {
  await clearFixtures();
  const orgId = await createProject();
  const issued = await issueToken({
    orgId,
    name: TOKEN_NAME,
    role: 'owner',
    createdBy: 'e2e-seed-api-docs-fixtures',
  });

  console.error(`[seed-api-docs-fixtures] project ${orgId} with one owner token`);

  // The one stdout line the spec parses. console.log is not available under
  // this repo's eslint config, and console.warn writes to stderr in Node.
  process.stdout.write(`${JSON.stringify({ orgId, token: issued.token })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-api-docs-fixtures] failed:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
