#!/usr/bin/env tsx
/**
 * seed-worker-run-usage-fixtures — the tenant the LARK-261 prompt-cache usage
 * spec drives (`e2e/worker-run-usage/worker-run-cache-usage.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own tenant account + project ("e2e-worker-run-usage"), so the spec
 *     runs against a fresh database (each CI shard starts with an empty Postgres) as well as a
 *     developer's, and never competes with whatever else lives there
 *   - one tenant API token for it, minted through `issueToken` — the same
 *     function `npm run tokens:issue` and the dashboard's "Create token"
 *     button call — so the spec drives the routes with a token shaped exactly
 *     like a real worker's
 *
 * The runs themselves are NOT seeded. The whole point of the spec is that a
 * worker creates, claims and heartbeats over real HTTP, so anything seeded
 * straight into the database would skip the route layer being tested.
 *
 * Idempotent: reruns delete this script's own fixture rows first (matched by
 * the fixed slugs below) before recreating them.
 *
 * Prints one JSON line to stdout — the org id and token the spec needs —
 * after every other message on this run went to stderr via console.error.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/worker-run-usage/support/seed-worker-run-usage-fixtures.ts
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  agentBudgetSchema,
  projectSchema,
  tenantAccountSchema,
  workerRunSchema,
} from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const ACCOUNT_SLUG = 'e2e-worker-run-usage';
const PROJECT_SLUG = 'e2e-worker-run-usage';
const TOKEN_NAME = 'e2e worker-run prompt-cache usage';

/**
 * Remove this script's project and everything scoped to it, so a rerun starts
 * from zero spend. Budget rows matter most here: the spec compares what three
 * agents were charged, and a leftover row from an earlier run would make the
 * comparison meaningless.
 */
async function resetFixtures(): Promise<void> {
  const [existing] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.slug, PROJECT_SLUG))
    .limit(1);
  if (existing) {
    await db.delete(workerRunSchema).where(eq(workerRunSchema.orgId, existing.id));
    await db.delete(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, existing.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG));
}

async function createProject(): Promise<string> {
  const accountId = `acct-e2e-worker-run-usage-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E Worker Run Usage',
    slug: ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-worker-run-usage-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: PROJECT_SLUG,
    name: 'E2E Worker Run Usage',
  });
  return projectId;
}

async function main(): Promise<void> {
  await resetFixtures();

  const orgId = await createProject();
  console.error(`[seed-worker-run-usage-fixtures] org (project "${PROJECT_SLUG}"): ${orgId}`);

  const token = await issueToken({
    orgId,
    name: TOKEN_NAME,
    role: 'owner',
    createdBy: 'e2e-seed-worker-run-usage-fixtures',
  });

  // The one stdout line the spec parses. Everything above went to stderr via
  // console.error, so this is the last thing on stdout. Written with
  // process.stdout.write rather than console.log because the repo's eslint
  // config only allows console.warn/console.error, and console.warn writes to
  // stderr in Node — it would not reach the spec's stdout capture.
  process.stdout.write(`${JSON.stringify({ orgId, token: token.token })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-worker-run-usage-fixtures] failed:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
