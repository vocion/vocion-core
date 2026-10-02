/**
 * A failed deploy nobody answered is answered by the reconcile (2026-10-01,
 * #294), against PGlite: a failed run of a deploy workflow with no answer is
 * handed to the automation that answers `run.failed`, once; a paused one is
 * not overridden but said on the environment and the feature, once; and the
 * feature's delivery says who is on it or what pause holds it. GitHub is
 * injected; every repository, name and sha is invented.
 */
import type { DeployFailureDeps } from './deployFailures';
import type { WorkflowRunSummary } from './githubChecks';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, automationRunSchema, automationSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { answerFailedDeploys, owedRuns } = await import('./deployFailures');

const ORG = 'org_deploy_failures';
const REPO = 'Acme/northwind-core';
const NOW = new Date('2026-10-01T12:35:00Z');
const SHA = 'c0ffee1234567890';
const RUN_URL = `https://github.com/${REPO}/actions/runs/36001`;
const types: Record<string, number> = {};
let envId = 0;
let requestId = 0;

function run(over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return { id: 36001, name: 'Deploy', path: '.github/workflows/deploy.yml', branch: 'main', headSha: SHA, event: 'push', status: 'completed', conclusion: 'failure', url: RUN_URL, runNumber: 59, attempt: 1, createdAt: '2026-10-01T10:21:20Z', updatedAt: '2026-10-01T10:23:54Z', ...over };
}

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!.metadata as Record<string, any>;
}

async function runsOf(slug: string) {
  return db.select().from(automationRunSchema).where(and(eq(automationRunSchema.orgId, ORG), eq(automationRunSchema.slug, slug)));
}

function deps(runs: WorkflowRunSummary[] = [run()]): DeployFailureDeps & { fire: ReturnType<typeof vi.fn> } {
  const fire = vi.fn(async (orgId: string, slug: string, payload: Record<string, unknown>) => {
    const [r] = await db.insert(automationRunSchema).values({ orgId, slug, kind: 'mission_check', status: 'running', invokedBy: 'system:factory-reconcile', input: payload }).returning({ id: automationRunSchema.id });
    return { automationRunId: r!.id };
  });
  return { runs: async () => runs, deployBranch: async () => 'main', fire };
}

beforeAll(async () => {
  for (const slug of ['environment', 'repo', 'request']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'northwind-core', metadata: { slug: 'northwind-core', url: `https://github.com/${REPO}` } });
  const [env] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.environment!, title: 'rooms-api-production', metadata: { slug: 'rooms-api-production', repo: 'northwind-core', deploy: { workflow: '.github/workflows/deploy.yml', step: 'API' } } }).returning();
  envId = env!.id;
  const [req] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'Show page count', metadata: { state: 'building', delivery: { prUrl: `https://github.com/${REPO}/pull/147`, pr: 'PR #147', repo: REPO, mergedAt: '2026-10-01T10:21:17Z', mergedBy: 'Dana Reyes', mergeSha: SHA, runs: [{ runId: 36001, name: 'Deploy', runNumber: 59, url: RUN_URL, status: 'completed', conclusion: 'failure', startedAt: '2026-10-01T10:21:20Z' }], runsReadAt: '2026-10-01T10:25:00Z' } } }).returning();
  requestId = req!.id;
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'release-engineer', name: 'Release engineer', systemPrompt: 'x' } as never);
  await db.insert(automationSchema).values([
    { orgId: ORG, slug: 'answer-failed-deploy', name: 'A failed deploy is an incident', status: 'active', ownerAgentSlug: 'release-engineer', whenConfig: { event: 'run.failed' }, doConfig: { checkMission: 'keep-the-pipeline-answered', prompt: 'read it' }, pausedAt: new Date('2026-09-21T13:01:46Z'), pausedBy: 'token:abc123', pausedNote: 'Hold the factory' },
    { orgId: ORG, slug: 'record-deploy', name: 'A deploy is written on its environments', status: 'active', ownerAgentSlug: 'release-engineer', whenConfig: { event: ['run.succeeded', 'run.failed'] }, doConfig: { job: 'factory-environment-deployed' } },
    { orgId: ORG, slug: 'on-pull-request', name: 'Unrelated', status: 'active', whenConfig: { event: 'pr.opened' }, doConfig: { job: 'x' } },
  ] as never);
  // The event arrived: the recording job ran for it, as it did on #294.
  await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'record-deploy', kind: 'job', status: 'ok', invokedBy: 'event:run.failed', input: { runId: 36001, runAttempt: 1 } });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('which failed runs are still owed an answer', () => {
  it('a failed run in the last day that no newer green run deployed past', () => {
    expect(owedRuns([run()], NOW).map(r => r.id)).toEqual([36001]);
    expect(owedRuns([run(), run({ id: 36002, runNumber: 60, conclusion: 'success', updatedAt: '2026-10-01T11:00:00Z' })], NOW)).toEqual([]);
    expect(owedRuns([run({ updatedAt: '2026-09-30T09:00:00Z' })], NOW)).toEqual([]);
    expect(owedRuns([run({ status: 'in_progress', conclusion: null })], NOW)).toEqual([]);
    expect(owedRuns([run({ conclusion: 'cancelled' })], NOW)).toEqual([]);
  });
});

describe('a failed deploy whose automation is paused', () => {
  it('is not answered, but said once on the environment and the feature, and the feature reads the pause', async () => {
    const d = deps();
    const out = await answerFailedDeploys(ORG, NOW, d);

    expect(d.fire).not.toHaveBeenCalled();
    expect(out.map(o => o.did)).toEqual(['failed deploy: automation paused']);

    const skips = (await runsOf('answer-failed-deploy')).filter(r => r.kind === 'skipped');

    expect(skips).toHaveLength(1);
    expect(skips[0]!.result).toMatchObject({ reason: 'automation_paused', paused: { since: '2026-09-21T13:01:46.000Z', by: 'API token abc123', note: 'Hold the factory' } });
    expect((await read(envId)).lastPipelineLine).toBe('Deploy run #59 on c0ffee1 failed at 10:23 UTC and would have been answered by "A failed deploy is an incident", but "A failed deploy is an incident" is paused (since 21 Sep 13:01 UTC, by API token abc123: "Hold the factory"). Resume it at /dashboard/automation/answer-failed-deploy and it runs again.');

    const req = await read(requestId);

    expect(req.recovery.log.at(-1).text).toContain('is paused (since 21 Sep 13:01 UTC');
    expect(req.delivery.answer).toMatchObject({ runId: 36001, slug: 'answer-failed-deploy', automation: 'A failed deploy is an incident', automationRunId: null, paused: { since: '2026-09-21T13:01:46.000Z', by: 'API token abc123', note: 'Hold the factory' } });
    // The delivery's own runs are kept.
    expect(req.delivery.runs).toHaveLength(1);

    // The next pass says nothing new: the run is keyed on its id and attempt.
    await answerFailedDeploys(ORG, NOW, d);

    expect((await runsOf('answer-failed-deploy')).filter(r => r.kind === 'skipped')).toHaveLength(1);
    expect((await read(requestId)).recovery.log.filter((e: { text: string }) => e.text.includes('is paused'))).toHaveLength(1);
  });
});

describe('once it is resumed', () => {
  it('the next pass answers the run, once, and the feature says who is on it', async () => {
    await db.update(automationSchema).set({ pausedAt: null, pausedBy: null, pausedNote: null }).where(and(eq(automationSchema.orgId, ORG), eq(automationSchema.slug, 'answer-failed-deploy')));
    const d = deps();

    const out = await answerFailedDeploys(ORG, NOW, d);

    // Only the automation that answers is fired: the recording job already ran for this run.
    expect(d.fire).toHaveBeenCalledTimes(1);
    expect(d.fire.mock.calls[0]![1]).toBe('answer-failed-deploy');
    expect(d.fire.mock.calls[0]![2]).toMatchObject({ repo: REPO, runId: 36001, runNumber: 59, runAttempt: 1, headSha: SHA, url: RUN_URL, conclusion: 'failure', dedupeKey: `github:${REPO}:run.failed:36001:1` });
    expect(out.map(o => o.did)).toEqual(['failed deploy: answered']);

    const req = await read(requestId);

    expect(req.delivery.answer).toMatchObject({ runId: 36001, by: 'Release engineer', paused: null, automationRunId: expect.any(Number) });
    expect(req.recovery.log.at(-1).text).toMatch(/^Deploy run #59 on c0ffee1 failed at 10:23 UTC and nothing answered it; the reconcile handed it to "A failed deploy is an incident" \(automation run #\d+\)\.$/);

    // Answered: the next pass fires nothing.
    await answerFailedDeploys(ORG, NOW, d);

    expect(d.fire).toHaveBeenCalledTimes(1);
  });

  it('a re-run attempt that fails again, and whose event never arrived, is a new run for every subscriber', async () => {
    const d = deps([run({ attempt: 2, updatedAt: '2026-10-01T12:30:00Z' })]);

    await answerFailedDeploys(ORG, NOW, d);

    expect(d.fire.mock.calls.map(c => c[1]).sort()).toEqual(['answer-failed-deploy', 'record-deploy']);
    expect(d.fire.mock.calls.every(c => (c[2] as { runAttempt: number }).runAttempt === 2)).toBe(true);
  });
});
