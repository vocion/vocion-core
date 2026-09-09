#!/usr/bin/env tsx
/**
 * seed-mission-run-fixtures — real data for the VEERIO-252 mission-run report
 * E2E spec (`e2e/mission-runs/mission-run-reports.spec.ts`).
 *
 * Builds, in the database the running app is actually pointed at:
 *   - a mission belonging to the existing `wt252` project (found by slug —
 *     bootstrap already seeded it, see the umbrella CLAUDE.md)
 *   - three runs on that mission: two completed runs with a populated
 *     `plan.tasks[0].output`, and one run whose `plan` column is a literal
 *     `null` (a row a hand edit or a pre-`tasks` write could leave behind),
 *     so the spec can prove the read routes do not throw on it
 *   - a second tenant account + project ("e2e-cross-org-mission-runs"), with
 *     its own tenant API token, so the cross-tenant check is a real token
 *     belonging to a real other org, not a forged claim
 *
 * Tokens are minted through `issueToken` — the same function
 * `npm run tokens:issue` and the dashboard's "Create token" button call — so
 * the spec drives the routes with tokens shaped exactly like a real
 * integration's.
 *
 * Idempotent: reruns delete this script's own fixture rows first (matched by
 * the fixed slugs/names below) before recreating them, so `npx playwright
 * test --project=mission-runs` stays repeatable against the same database.
 *
 * Prints one JSON line to stdout — the ids and tokens the spec needs — after
 * every other message on this run went to stderr via console.error.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/mission-runs/support/seed-mission-run-fixtures.ts
 */
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  missionRunSchema,
  missionSchema,
  projectSchema,
  tenantAccountSchema,
} from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';
import 'dotenv/config';

const PRIMARY_PROJECT_SLUG = 'wt252';
const MISSION_SLUG = 'e2e-nightly-source-refresh';
const CROSS_ORG_ACCOUNT_SLUG = 'e2e-cross-org-mission-runs';
const CROSS_ORG_PROJECT_SLUG = 'e2e-cross-org-mission-runs';
const TOKEN_NAME_PRIMARY = 'e2e mission-run reports (primary org)';
const TOKEN_NAME_OTHER = 'e2e mission-run reports (other org)';

async function findPrimaryProject() {
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.slug, PRIMARY_PROJECT_SLUG))
    .limit(1);
  if (!project) {
    throw new Error(`no project with slug "${PRIMARY_PROJECT_SLUG}" — expected the worktree's seeded demo project`);
  }
  return project.id;
}

/**
 * Delete this script's own fixture rows so reruns start clean. Order matters:
 * runs before the mission (FK `mission_run.mission_id` references `mission`),
 * project before account (FK `project.account_id` references `tenant_account`).
 * @param orgId - The primary org's id, to scope the mission delete.
 */
async function resetFixtures(orgId: string): Promise<void> {
  const [existingMission] = await db
    .select({ id: missionSchema.id })
    .from(missionSchema)
    .where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, MISSION_SLUG)))
    .limit(1);
  if (existingMission) {
    await db.delete(missionRunSchema).where(eq(missionRunSchema.missionId, existingMission.id));
    await db.delete(missionSchema).where(eq(missionSchema.id, existingMission.id));
  }

  const [existingOtherProject] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.slug, CROSS_ORG_PROJECT_SLUG))
    .limit(1);
  if (existingOtherProject) {
    await db.delete(missionRunSchema).where(eq(missionRunSchema.orgId, existingOtherProject.id));
    await db.delete(missionSchema).where(eq(missionSchema.orgId, existingOtherProject.id));
    await db.delete(projectSchema).where(eq(projectSchema.id, existingOtherProject.id));
  }
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.slug, CROSS_ORG_ACCOUNT_SLUG));
}

async function createCrossOrgProject(): Promise<string> {
  const accountId = `acct-e2e-${Date.now()}`;
  await db.insert(tenantAccountSchema).values({
    id: accountId,
    name: 'E2E Cross-Org (mission runs)',
    slug: CROSS_ORG_ACCOUNT_SLUG,
  });
  const projectId = `proj-e2e-${Date.now()}`;
  await db.insert(projectSchema).values({
    id: projectId,
    accountId,
    slug: CROSS_ORG_PROJECT_SLUG,
    name: 'E2E Cross-Org (mission runs)',
  });
  return projectId;
}

async function main(): Promise<void> {
  const primaryOrgId = await findPrimaryProject();
  console.error(`[seed-mission-run-fixtures] primary org (project "${PRIMARY_PROJECT_SLUG}"): ${primaryOrgId}`);

  await resetFixtures(primaryOrgId);

  const [mission] = await db
    .insert(missionSchema)
    .values({
      orgId: primaryOrgId,
      slug: MISSION_SLUG,
      name: 'Nightly source refresh (e2e fixture)',
      goal: 'Refresh every registered knowledge source and report what changed.',
      agentSlug: 'event-ingestion-lead',
    })
    .returning({ id: missionSchema.id });
  const missionId = mission!.id;

  const team = { lead: 'event-ingestion-lead', members: [] as string[] };

  const [runA] = await db
    .insert(missionRunSchema)
    .values({
      orgId: primaryOrgId,
      missionId,
      title: 'Nightly source refresh — run A',
      brief: 'Refresh every registered knowledge source and report what changed.',
      status: 'completed',
      team,
      plan: {
        tasks: [
          {
            id: 't1',
            title: 'Refresh registered sources',
            ownerAgentSlug: 'event-ingestion-lead',
            type: 'action',
            status: 'completed',
            output: 'found 3, refreshed 3, failed 0',
          },
        ],
      },
      completedAt: new Date(),
    })
    .returning({ id: missionRunSchema.id });

  const [runB] = await db
    .insert(missionRunSchema)
    .values({
      orgId: primaryOrgId,
      missionId,
      title: 'Nightly source refresh — run B',
      brief: 'Refresh every registered knowledge source and report what changed.',
      status: 'completed',
      team,
      plan: {
        tasks: [
          {
            id: 't1',
            title: 'Refresh registered sources',
            ownerAgentSlug: 'event-ingestion-lead',
            type: 'action',
            status: 'failed',
            output: '0 proposals — every source returned empty',
            error: 'source registry returned zero rows',
          },
        ],
      },
      completedAt: new Date(),
    })
    .returning({ id: missionRunSchema.id });

  // A run whose `plan` column is a literal NULL — the shape the route's
  // `normalizePlanTasks` guard exists for. `plan` carries a column default,
  // not a NOT NULL constraint, so passing `null` explicitly overrides that
  // default and reaches the database as NULL, the same as a row written
  // before `tasks` existed or edited by hand.
  const [runMalformed] = await db
    .insert(missionRunSchema)
    .values({
      orgId: primaryOrgId,
      missionId,
      title: 'Nightly source refresh — run with null plan',
      brief: 'Refresh every registered knowledge source and report what changed.',
      status: 'failed',
      team,
      plan: null,
      error: 'planning crashed before a plan was recorded',
    })
    .returning({ id: missionRunSchema.id });

  const otherOrgId = await createCrossOrgProject();

  const primaryToken = await issueToken({
    orgId: primaryOrgId,
    name: TOKEN_NAME_PRIMARY,
    role: 'owner',
    createdBy: 'e2e-seed-mission-run-fixtures',
  });
  const otherOrgToken = await issueToken({
    orgId: otherOrgId,
    name: TOKEN_NAME_OTHER,
    role: 'owner',
    createdBy: 'e2e-seed-mission-run-fixtures',
  });

  console.error(`[seed-mission-run-fixtures] mission "${MISSION_SLUG}" (id ${missionId}) with runs ${runA!.id}, ${runB!.id}, ${runMalformed!.id}`);
  console.error(`[seed-mission-run-fixtures] cross-org project: ${otherOrgId}`);

  // The one stdout line the spec parses. Everything above went to stderr via
  // console.error, so this is the last thing on stdout. Written with
  // process.stdout.write rather than console.log because the repo's eslint
  // config only allows console.warn/console.error, and console.warn writes
  // to stderr in Node — it would not reach the spec's stdout capture.
  process.stdout.write(`${JSON.stringify({
    primaryOrgId,
    otherOrgId,
    missionSlug: MISSION_SLUG,
    runIdWithOutput: runA!.id,
    runIdFailedWithOutput: runB!.id,
    runIdNullPlan: runMalformed!.id,
    primaryToken: primaryToken.token,
    otherOrgToken: otherOrgToken.token,
  })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-mission-run-fixtures] failed:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
