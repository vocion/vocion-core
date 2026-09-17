#!/usr/bin/env tsx
/**
 * seed-eval-provider-fixtures — the rows the eval provider UI spec reads
 * (`e2e/evals-providers/evals-providers.spec.ts`).
 *
 * Attaches to the project the bootstrap admin already owns, found by that
 * admin's email, so the spec signs in as a real user and sees real rows rather
 * than a project nobody belongs to.
 *
 * Builds three datasets, one per state the UI has to get right:
 *   - `e2e-untouched` — no runs at all, for the "no runs yet" state, which
 *     must not read as 0%.
 *   - `e2e-one-grader` — a Vocion dataset with Vocion runs, the ordinary case.
 *   - `e2e-changed-graders` — an AgentCore dataset that used to be scored by
 *     Vocion, across two dataset versions, so the grader chip, the note about
 *     older runs and the version boundary all have something to draw. An eval
 *     only ever has one grader now, so the second one can only be history. It
 *     also carries a published copy in AWS whose cases have since been edited,
 *     which is the drift state.
 *   - `e2e-not-copied` — an AgentCore dataset with no published copy at all,
 *     which is both the first-run state and every AgentCore dataset that
 *     existed before publishing did.
 *
 * Also files one activity event for the agent, which is what puts it on the
 * adoption page where the eval pass rate sits beside the agreement rate.
 *
 * No agent is ever run and no model is ever called: every run row here is
 * written directly, already finished.
 *
 * Idempotent — deletes its own rows first, matched on the fixed slugs below.
 *
 * Prints one JSON line to stdout; everything else goes to stderr.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/evals-providers/support/seed-eval-provider-fixtures.ts --email <admin email>
 */
import process from 'node:process';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  evalCaseResultSchema,
  evalDatasetRemoteSchema,
  evalDatasetSchema,
  evalRunSchema,
  projectSchema,
  userActivityEventSchema,
  userSchema,
} from '@/models/Schema';
import 'dotenv/config';

const AGENT_SLUG = 'e2e-eval-agent';
const UNTOUCHED = 'e2e-untouched';
const ONE_GRADER = 'e2e-one-grader';
const CHANGED_GRADERS = 'e2e-changed-graders';
const NOT_COPIED = 'e2e-not-copied';
const SLUGS = [UNTOUCHED, ONE_GRADER, CHANGED_GRADERS, NOT_COPIED];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * Read `--email <value>` off the command line.
 */
function emailArgument(): string {
  const index = process.argv.indexOf('--email');
  const email = index >= 0 ? process.argv[index + 1] : undefined;
  if (!email) {
    throw new Error('pass --email <the bootstrap admin\'s email>');
  }
  return email;
}

/**
 * The project the signed-in admin will actually be looking at.
 * @param email - The bootstrap admin's email.
 */
async function orgIdForAdmin(email: string): Promise<string> {
  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email));
  if (!user) {
    throw new Error(`no user with email ${email} — run create-local-user.ts first`);
  }
  const [membership] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, user.id));
  if (!membership) {
    throw new Error(`user ${email} belongs to no account`);
  }
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, membership.accountId));
  if (!project) {
    throw new Error(`account ${membership.accountId} has no project`);
  }
  return project.id;
}

/**
 * Remove this script's own rows so a rerun starts clean.
 * @param orgId - The project the fixtures live in.
 */
async function resetFixtures(orgId: string): Promise<void> {
  const datasets = await db
    .select({ id: evalDatasetSchema.id })
    .from(evalDatasetSchema)
    .where(and(eq(evalDatasetSchema.orgId, orgId), inArray(evalDatasetSchema.slug, SLUGS)));
  for (const dataset of datasets) {
    const runs = await db
      .select({ id: evalRunSchema.id })
      .from(evalRunSchema)
      .where(eq(evalRunSchema.datasetId, dataset.id));
    for (const run of runs) {
      await db.delete(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, run.id));
    }
    await db.delete(evalRunSchema).where(eq(evalRunSchema.datasetId, dataset.id));
  }
  await db.delete(evalDatasetSchema).where(and(eq(evalDatasetSchema.orgId, orgId), inArray(evalDatasetSchema.slug, SLUGS)));
  await db
    .delete(userActivityEventSchema)
    .where(and(eq(userActivityEventSchema.orgId, orgId), eq(userActivityEventSchema.agentSlug, AGENT_SLUG)));
}

/**
 * Create one dataset and hand back its id.
 * @param orgId - Whose workspace.
 * @param slug - Dataset slug.
 * @param version - Which version the dataset is on now.
 * @param provider - The one grader this dataset is scored by.
 */
async function createDataset(orgId: string, slug: string, version: number, provider = 'vocion'): Promise<number> {
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId,
    slug,
    name: slug,
    agentSlug: AGENT_SLUG,
    provider,
    items: [{ input: 'Does the refund go through?' }],
    version,
  }).returning({ id: evalDatasetSchema.id });
  return dataset!.id;
}

/**
 * Write one finished run, with no cases — the UI states under test read the
 * run row and its metrics, never the transcripts.
 * @param values - Everything the row needs.
 * @param values.orgId - Which org owns the run.
 * @param values.datasetId - The dataset this run graded.
 * @param values.provider - Which grader produced it.
 * @param values.passRate - Share of cases that passed, 0 to 1.
 * @param values.datasetVersion - The dataset revision the run scored.
 * @param values.startedAt - When the run began, which orders it on the chart.
 */
async function createRun(values: {
  orgId: string;
  datasetId: number;
  provider: string;
  passRate: number;
  datasetVersion: number;
  startedAt: Date;
}): Promise<void> {
  await db.insert(evalRunSchema).values({
    orgId: values.orgId,
    datasetId: values.datasetId,
    agentSlug: AGENT_SLUG,
    provider: values.provider,
    status: 'succeeded',
    datasetVersion: values.datasetVersion,
    metrics: { passRate: values.passRate, passed: 1, failed: 0 },
    startedAt: values.startedAt,
    completedAt: values.startedAt,
  });
}

/**
 * Record a dataset as published into a grader's account.
 *
 * `casesHash` is what decides whether the page says the copy is in step, so a
 * hash that matches nothing is how the fixture asks for the drift state.
 * @param values - Everything the row needs.
 * @param values.orgId - Whose workspace.
 * @param values.datasetId - Which dataset was published.
 * @param values.casesHash - The content hash of the cases last published.
 */
async function createRemoteCopy(values: {
  orgId: string;
  datasetId: number;
  casesHash: string;
}): Promise<void> {
  await db.insert(evalDatasetRemoteSchema).values({
    orgId: values.orgId,
    datasetId: values.datasetId,
    provider: 'agentcore',
    remoteId: 'ds-e2e-fixture',
    remoteVersion: '2',
    casesHash: values.casesHash,
    status: 'ACTIVE',
    syncedAt: daysAgo(3),
  });
}

async function main(): Promise<void> {
  const email = emailArgument();
  const orgId = await orgIdForAdmin(email);
  await resetFixtures(orgId);

  await createDataset(orgId, UNTOUCHED, 1);

  const oneGrader = await createDataset(orgId, ONE_GRADER, 1);
  await createRun({ orgId, datasetId: oneGrader, provider: 'vocion', passRate: 0.75, datasetVersion: 1, startedAt: daysAgo(3) });
  await createRun({ orgId, datasetId: oneGrader, provider: 'vocion', passRate: 0.8, datasetVersion: 1, startedAt: daysAgo(1) });

  // Scored by AgentCore now; the oldest run predates the switch and still
  // belongs to Vocion, which is the only way two graders can appear on one
  // dataset.
  const changedGraders = await createDataset(orgId, CHANGED_GRADERS, 2, 'agentcore');
  await createRun({ orgId, datasetId: changedGraders, provider: 'vocion', passRate: 0.6, datasetVersion: 1, startedAt: daysAgo(4) });
  await createRun({ orgId, datasetId: changedGraders, provider: 'agentcore', passRate: 0.9, datasetVersion: 1, startedAt: daysAgo(3) });
  await createRun({ orgId, datasetId: changedGraders, provider: 'agentcore', passRate: 0.7, datasetVersion: 2, startedAt: daysAgo(1) });

  // Published to AWS three days ago, and a case has been edited since.
  await createRemoteCopy({ orgId, datasetId: changedGraders, casesHash: 'hash-of-an-earlier-version' });

  // An AgentCore dataset with no remote row at all: what every AgentCore
  // dataset looked like before publishing existed, and what a new one looks
  // like until its first run.
  await createDataset(orgId, NOT_COPIED, 1, 'agentcore');

  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email));
  await db.insert(userActivityEventSchema).values({
    orgId,
    userId: user!.id,
    eventType: 'chat.message_sent',
    agentSlug: AGENT_SLUG,
    metadata: {},
    createdAt: daysAgo(1),
  });

  console.error(`[seed-eval-provider-fixtures] org ${orgId}, agent ${AGENT_SLUG}`);
  process.stdout.write(`${JSON.stringify({
    orgId,
    agentSlug: AGENT_SLUG,
    untouchedSlug: UNTOUCHED,
    oneGraderSlug: ONE_GRADER,
    changedGradersSlug: CHANGED_GRADERS,
    notCopiedSlug: NOT_COPIED,
  })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[seed-eval-provider-fixtures] failed', error);
    process.exit(1);
  });
