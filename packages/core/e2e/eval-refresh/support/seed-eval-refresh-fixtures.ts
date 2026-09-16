#!/usr/bin/env tsx
/**
 * seed-eval-refresh-fixtures — real data for the eval refresh E2E spec
 * (`e2e/eval-refresh/eval-refresh.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - its own tenant account + project ("e2e-eval-refresh-primary"), so the
 *     spec works against a fresh CI database as well as a developer's, and
 *     never competes with whatever else lives there
 *   - one eval dataset belonging to that project, with two cases
 *   - a second tenant account + project with its own token, so the
 *     cross-tenant check uses a real token belonging to a real other org
 *     rather than a forged claim
 *
 * Tokens are minted through `issueToken`, the same function the dashboard's
 * "Create token" button calls, so the spec drives the route with tokens shaped
 * exactly like a real integration's.
 *
 * Idempotent: reruns delete this script's own rows first, matched by the fixed
 * slugs below.
 *
 * Prints one JSON line to stdout — everything else goes to stderr.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/eval-refresh/support/seed-eval-refresh-fixtures.ts
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  evalCaseResultSchema,
  evalDatasetSchema,
  evalRunSchema,
  projectSchema,
  tenantAccountSchema,
} from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const PRIMARY_ACCOUNT_SLUG = 'e2e-eval-refresh-primary';
const PRIMARY_PROJECT_SLUG = 'e2e-eval-refresh-primary';
const CROSS_ORG_ACCOUNT_SLUG = 'e2e-cross-org-eval-refresh';
const CROSS_ORG_PROJECT_SLUG = 'e2e-cross-org-eval-refresh';
const DATASET_SLUG = 'e2e-refund-quality';
const TOKEN_NAME_PRIMARY = 'e2e eval refresh (primary org)';
const TOKEN_NAME_OTHER = 'e2e eval refresh (other org)';

/**
 * Delete one of this script's projects and everything scoped to it.
 *
 * Case results before runs before datasets, following the foreign keys, then
 * the project, then the account. Tokens carry `org_id` without a foreign key,
 * so a stale one is left behind and simply stops resolving to a project.
 * @param projectSlug - Slug of the project to remove, if it exists.
 * @param accountSlug - Slug of the account that owns it.
 */
async function deleteProjectAndAccount(projectSlug: string, accountSlug: string): Promise<void> {
  const [existing] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.slug, projectSlug))
    .limit(1);
  if (existing) {
    const runs = await db
      .select({ id: evalRunSchema.id })
      .from(evalRunSchema)
      .where(eq(evalRunSchema.orgId, existing.id));
    for (const run of runs) {
      await db.delete(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, run.id));
    }
    await db.delete(evalRunSchema).where(eq(evalRunSchema.orgId, existing.id));
    await db.delete(evalDatasetSchema).where(eq(evalDatasetSchema.orgId, existing.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existing.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, accountSlug));
}

/**
 * Create one account and one project, and hand back the project id.
 * @param accountSlug - Slug for the account.
 * @param projectSlug - Slug for the project.
 * @param name - Display name for both.
 */
async function createProject(accountSlug: string, projectSlug: string, name: string): Promise<string> {
  const accountId = `acct-${projectSlug}-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({ id: accountId, name, slug: accountSlug });
  const projectId = `proj-${projectSlug}-${Date.now()}`;
  await db.insert(projectSchema).values({ id: projectId, accountId, slug: projectSlug, name });
  return projectId;
}

async function main(): Promise<void> {
  await deleteProjectAndAccount(PRIMARY_PROJECT_SLUG, PRIMARY_ACCOUNT_SLUG);
  await deleteProjectAndAccount(CROSS_ORG_PROJECT_SLUG, CROSS_ORG_ACCOUNT_SLUG);

  const primaryOrgId = await createProject(PRIMARY_ACCOUNT_SLUG, PRIMARY_PROJECT_SLUG, 'E2E Eval Refresh');
  console.error(`[seed-eval-refresh-fixtures] primary org: ${primaryOrgId}`);

  await db.insert(evalDatasetSchema).values({
    orgId: primaryOrgId,
    slug: DATASET_SLUG,
    name: 'Refund quality (e2e fixture)',
    agentSlug: 'support-agent',
    items: [
      { input: 'I want a refund for order 1182.', expectedOutput: 'Confirms the refund and names the order.' },
      { input: 'Where is my order?', expectedOutput: 'Gives the status without promising a date.' },
    ],
  });

  const otherOrgId = await createProject(CROSS_ORG_ACCOUNT_SLUG, CROSS_ORG_PROJECT_SLUG, 'E2E Cross-Org (eval refresh)');

  const primaryToken = await issueToken({ orgId: primaryOrgId, name: TOKEN_NAME_PRIMARY, role: 'owner' });
  const otherOrgToken = await issueToken({ orgId: otherOrgId, name: TOKEN_NAME_OTHER, role: 'owner' });

  // process.stdout.write rather than console.log: this repo's eslint allows
  // only console.warn and console.error, and console.warn writes to stderr in
  // Node, where the spec's stdout capture would never see it.
  process.stdout.write(`${JSON.stringify({
    primaryOrgId,
    otherOrgId,
    datasetSlug: DATASET_SLUG,
    primaryToken: primaryToken.token,
    otherOrgToken: otherOrgToken.token,
  })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-eval-refresh-fixtures] failed', error);
    process.exit(1);
  });
