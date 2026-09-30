import type { CiCause } from './ciDiagnose';
/**
 * A red CI on a factory pull request is answered by its cause (backlog 049),
 * against PGlite. The GitHub reads and the diagnosis are injected; the action
 * rail, the trust ladder, the asks and the request's own account are real.
 * Every name, repo and path is invented.
 */
import type { CheckLogs } from './githubChecks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./githubChecks', async importOriginal => ({
  ...(await importOriginal<typeof import('./githubChecks')>()),
  rerunFailedJobs: vi.fn(async (_orgId: string, _url: string, headSha: string | null) => ({ repo: 'Acme/northwind-core', headSha, runIds: [9001] })),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, businessObjectSchema, eventLogSchema, trustRuleSchema, workerRunSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const carry = await import('./carry');
const { ciFailed } = await import('./ciFailed');
const { intakeDecision } = await import('./recovery');

const ORG = 'org_factory_ci_failed';
const REPO = 'Acme/northwind-core';
const types: Record<string, number> = {};
const previous = process.env.VOCION_EXTERNAL_WORKERS;

beforeAll(async () => {
  process.env.VOCION_EXTERNAL_WORKERS = '1';
  for (const slug of ['request', 'engineering_task', 'architecture_plan', 'repo']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: { runsOn: 'external-worker' } } as never);
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: REPO, metadata: { checks: [{ name: 'test' }, { name: 'lint' }], productPaths: { rooms: ['apps/web/src/**'] } } });
  for (const actionId of ['factory.dispatch_task.from_request', 'factory.dispatch_task.recovery', 'factory.dispatch_task.retry', 'github.rerun_failed_jobs']) {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: 0.8, enabled: 'true' });
  }
});

afterAll(() => {
  process.env.VOCION_EXTERNAL_WORKERS = previous;
});

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!;
}

let prNumber = 300;
async function waitingOnQa(title: string) {
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title, metadata: { kind: 'bug', severity: 'p1', state: 'new', product: 'rooms', outcome: 'It works.', acceptance: ['An invited member opens the room.'], ownerRepo: REPO } }).returning();
  await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r!.id, conversationId: 12, byPerson: true });
  const task = (await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.engineering_task!))))
    .filter(t => Number((t.metadata as Record<string, unknown>).requestId) === r!.id)
    .at(-1)!;
  for (const run of await db.select().from(workerRunSchema).where(eq(workerRunSchema.orgId, ORG))) {
    await db.update(workerRunSchema).set({ status: 'completed' }).where(eq(workerRunSchema.id, run.id));
  }
  prNumber += 1;
  const prUrl = `https://github.com/${REPO}/pull/${prNumber}`;
  await db.update(businessObjectSchema).set({ status: 'awaiting_review', metadata: { ...(task.metadata as Record<string, unknown>), status: 'awaiting_review', prUrl, commitSha: 'bc9f315a148d' } }).where(eq(businessObjectSchema.id, task.id));
  return { request: r!, task, prUrl };
}

const LOGS = (prUrl: string): CheckLogs => ({
  repo: REPO,
  number: Number(prUrl.split('/').at(-1)),
  headSha: 'bc9f315a148d3d8d',
  baseBranch: 'main',
  checkCount: 4,
  failing: [{ name: 'test', conclusion: 'failure', url: null, step: 'Run the suite', annotations: ['apps/web/src/rooms.test.ts:42 expected 200, got 403'], summary: null, logTail: 'FAIL apps/web/src/rooms.test.ts > opens an invited room' }],
  changedFiles: ['apps/web/src/rooms.ts'],
});

function deps(cause: CiCause | null, opts: { baseFailing?: string[]; fixIn?: 'code' | 'pipeline' } = {}) {
  return {
    readLogs: async (_o: string, url: string) => LOGS(url),
    baseChecks: async () => ({ sha: 'a1a1a1a1a1a1', complete: true, failing: opts.baseFailing ?? [] }),
    diagnose: vi.fn(async () => (cause ? { cause, why: `It reads as ${cause}.`, failing: 'rooms.test.ts > opens an invited room', ...(opts.fixIn ? { fixIn: opts.fixIn } : {}) } : null)),
    liveHead: async () => 'bc9f315a148d3d8d',
  };
}

const event = (prUrl: string, key: string) => ({ url: prUrl, conclusion: 'failure', headSha: 'bc9f315a148d3d8d', failedChecks: 'test', dedupeKey: key, owner: 'release-engineer' });

function log(meta: unknown): string[] {
  return (((meta as { recovery?: { log?: Array<{ text: string }> } }).recovery?.log) ?? []).map(l => l.text);
}

describe('a red CI goes where its cause says (backlog 049)', () => {
  it('the change broke it: back to the engineer with the failing test named, on the request\'s own account', async () => {
    const { request, task, prUrl } = await waitingOnQa('Invited members open rooms');
    const d = deps('change_broke_it');

    const out = await ciFailed(ORG, event(prUrl, 'k-change-1'), d);

    expect(out.did).toBe('ci failed: built again');
    // Changes asked — and, since the retry runs done for you here, superseded by the next attempt.
    expect(['changes_requested', 'abandoned']).toContain((await read(task.id)).status);
    expect(out.line).toContain('Build again started on its own');
    expect((await read(task.id)).metadata).toMatchObject({ ciDiagnosis: { cause: 'change_broke_it', key: 'k-change-1', failing: 'rooms.test.ts > opens an invited room' } });
    expect(out.line).toMatch(/^CI failed: rooms\.test\.ts > opens an invited room\. It reads as change_broke_it\. So it is back with the engineer\./);
    expect(log((await read(request.id)).metadata).some(l => l.startsWith('CI failed: rooms.test.ts > opens an invited room'))).toBe(true);
    // The diagnosis read GitHub's evidence and the base branch.
    expect(d.diagnose).toHaveBeenCalledWith(expect.objectContaining({ prUrl, base: expect.objectContaining({ branch: 'main', failing: [] }) }));
  });

  it('flaky: the failed jobs are re-run once, done for you; failing again on the same head is the change\'s', async () => {
    const { task, prUrl } = await waitingOnQa('Rooms list their guests');

    const first = await ciFailed(ORG, event(prUrl, 'k-flaky-1'), deps('flaky'));

    expect(first.did).toBe('ci flaky: re-ran');
    expect(first.line).toContain('The failed jobs were re-run once (action #');
    expect((await read(task.id)).status).toBe('awaiting_review');
    expect((await read(task.id)).metadata).toMatchObject({ ciRerun: { count: 1 } });

    // The same event again (the webhook and the reconciler both raised it) acts once.
    expect((await ciFailed(ORG, event(prUrl, 'k-flaky-1'), deps('flaky'))).did).toBe('already answered');

    // The re-run failed too: a new event on the same head, read as flaky again, is the change's.
    const again = await ciFailed(ORG, event(prUrl, 'k-flaky-2'), deps('flaky'));

    expect(again.did).toBe('ci failed: built again');
    expect(again.line).toContain('It failed again after a re-run.');
    expect(['changes_requested', 'abandoned']).toContain((await read(task.id)).status);
  });

  it('main is broken: one fix on the default branch for every pull request behind it, each marked blocked', async () => {
    const a = await waitingOnQa('Rooms show their owner');
    const b = await waitingOnQa('Rooms show their theme');

    const first = await ciFailed(ORG, event(a.prUrl, 'k-main-a'), deps('main_broken', { baseFailing: ['test'] }));
    const second = await ciFailed(ORG, event(b.prUrl, 'k-main-b'), deps('main_broken', { baseFailing: ['test'] }));

    expect(first.did).toBe('ci main broken: fix filed');
    expect(second.line).toContain('already covers it');

    const fixes = (await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.request!))))
      .filter(r => (r.metadata as Record<string, unknown>).pipelineFix);

    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.metadata).toMatchObject({ kind: 'incident', channel: 'github', product: 'rooms', pipelineFix: { repo: REPO, branch: 'main', failing: ['test'], blocks: [{ url: a.prUrl, taskId: a.task.id }, { url: b.prUrl, taskId: b.task.id }] } });
    // Neither pull request goes back to its engineer: the change did not break it.
    expect((await read(a.task.id)).status).toBe('awaiting_review');
    expect((await read(a.task.id)).metadata).toMatchObject({ mainBlocked: { requestId: fixes[0]!.id, branch: 'main' } });
    // The fix is the factory's own filing, so it starts without a card.
    expect(intakeDecision({ meta: fixes[0]!.metadata as Record<string, unknown>, origin: { conversationId: null, byPerson: false } })).toMatchObject({ do: 'start', why: `main of ${REPO} is red, and 2 pull requests wait on it` });
  });

  it('the fix for a red base is never blocked by that base: its own red CI is the change\'s', async () => {
    const { request, prUrl } = await waitingOnQa('main is red on Acme/northwind-core: test');
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(request.id)).metadata as Record<string, unknown>), pipelineFix: { repo: REPO, branch: 'main', blocks: [] } } }).where(eq(businessObjectSchema.id, request.id));

    const out = await ciFailed(ORG, event(prUrl, 'k-fix-1'), deps('main_broken', { baseFailing: ['test'] }));

    expect(out.did).toBe('ci failed: built again');
  });

  it('main is red in its pipeline: one fix its owner writes, no engineer build, and the owner is asked', async () => {
    const a = await waitingOnQa('Rooms list their archived guests');

    const out = await ciFailed(ORG, event(a.prUrl, 'k-mainpipe-a'), deps('main_broken', { baseFailing: ['e2e'], fixIn: 'pipeline' }));

    expect(out.did).toBe('ci main broken: owner fixing');
    expect(out.line).toContain('Its pipeline is being fixed by its owner');

    const fix = (await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.request!))))
      .find(r => ((r.metadata as Record<string, any>).pipelineFix?.blocks ?? []).some((b: { url: string }) => b.url === a.prUrl))!;

    expect(fix.metadata).toMatchObject({ pipelineFix: { fixIn: 'pipeline', cause: 'main_broken' }, pipelineWork: { attempt: 1, cause: 'main_broken', owner: 'release-engineer', requestId: fix.id } });
    // Nothing is built for it: the fix is in the pipeline, and its owner writes it.
    expect(intakeDecision({ meta: fix.metadata as Record<string, unknown>, origin: { conversationId: null, byPerson: false } })).toMatchObject({ do: 'skip' });

    const [raised] = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.dedupeKey, `pipeline.needs_fix:${fix.id}:1`)));

    expect(raised).toMatchObject({ type: 'pipeline.needs_fix' });
    expect(raised!.payload).toMatchObject({ recordId: fix.id, repo: REPO, branch: 'main', cause: 'main_broken', attempt: 1, attempts: 2, url: a.prUrl });
  });

  it('the pipeline could not run: re-run once, done for you; again, its owner fixes the pipeline', async () => {
    // Every earlier fix on this branch has landed.
    for (const r of await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.request!)))) {
      const m = r.metadata as Record<string, any>;
      if (m.pipelineFix) {
        await db.update(businessObjectSchema).set({ metadata: { ...m, pipelineFix: { ...m.pipelineFix, recheckedAt: '2026-09-30T00:00:00Z' } } }).where(eq(businessObjectSchema.id, r.id));
      }
    }
    const { request, task, prUrl } = await waitingOnQa('Rooms remember the last visit');

    const first = await ciFailed(ORG, event(prUrl, 'k-infra-1'), deps('infra'));

    expect(first.did).toBe('ci infra: re-ran');
    expect(first.line).toContain('The failed jobs were re-run once (action #');
    expect((await read(task.id)).metadata).toMatchObject({ ciRerun: { count: 1 } });

    const again = await ciFailed(ORG, event(prUrl, 'k-infra-2'), deps('infra'));

    expect(again.did).toBe('ci infra: owner fixing');
    expect(again.line).toContain('CI could not run again after a re-run');
    // The pull request waits on the fix, not on its engineer.
    expect((await read(task.id)).status).toBe('awaiting_review');

    const blocked = (await read(task.id)).metadata as Record<string, any>;
    const fix = await read(blocked.mainBlocked.requestId);

    expect(fix.title).toBe(`The pipeline could not run on ${REPO}: test`);
    expect(fix.metadata).toMatchObject({ pipelineFix: { cause: 'infra', fixIn: 'pipeline' }, pipelineWork: { attempt: 1, cause: 'infra' } });
    expect(log((await read(request.id)).metadata).some(l => l.startsWith('CI could not run again'))).toBe(true);
    expect(log(fix.metadata).some(l => l.includes('is fixing the pipeline (attempt 1 of 2)'))).toBe(true);
  });

  it('a diagnosis that could not be made sends it back to the engineer and says so', async () => {
    const { task, prUrl } = await waitingOnQa('Rooms open from a phone');

    const out = await ciFailed(ORG, event(prUrl, 'k-none-1'), deps(null));

    expect(out.did).toBe('ci failed: built again');
    expect(out.line).toContain('The cause could not be read, so it is back with the engineer.');
    expect((await read(task.id)).metadata).toMatchObject({ ciDiagnosis: { cause: 'change_broke_it', read: null } });
  });

  it('ignores checks for a commit that is neither the task\'s nor the pull request\'s head', async () => {
    const { prUrl } = await waitingOnQa('Rooms open from a tablet');
    const d = { ...deps('change_broke_it'), liveHead: async () => 'bc9f315a148d3d8d' };

    const out = await ciFailed(ORG, { ...event(prUrl, 'k-other-1'), headSha: 'ffff0000aaaa' }, d);

    expect(out.did).toBe('the checks are for another commit');
    expect(d.diagnose).not.toHaveBeenCalled();
  });
});
