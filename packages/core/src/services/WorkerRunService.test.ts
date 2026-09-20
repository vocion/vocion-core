import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const svc = await import('@/services/WorkerRunService');
const { verifyClaim } = await import('@/services/agents/claims');

const ORG = 'org_test';

beforeEach(async () => {
  await db.delete(workerRunSchema);
});

describe('WorkerRunService — the lease protocol', () => {
  it('queues, claims, heartbeats and completes a run', async () => {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo', input: { message: 'go' }, capCents: 1000, createdBy: 'user:1' });

    expect(run.status).toBe('queued');
    expect(run.attempt).toBe(0);

    const { run: claimed, toolClaim } = await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'laptop-1' });

    expect(claimed.status).toBe('running');
    expect(claimed.attempt).toBe(1);
    expect(claimed.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    const v = verifyClaim(toolClaim);

    expect(v.ok && v.claim.agentSlug).toBe('ceo');
    expect(v.ok && v.claim.orgId).toBe(ORG);

    const hb = await svc.heartbeatWorkerRun({
      orgId: ORG,
      id: run.id,
      workerId: 'laptop-1',
      progress: { step: 'writing' },
      usage: { model: 'claude-opus-5', inputTokens: 1000, outputTokens: 500, cents: 400 },
    });

    expect(hb.stop).toBe(false);
    expect(hb.capRemainingCents).toBe(600);
    expect(hb.run.tokens).toBe(1500);
    expect(hb.run.cents).toBe(400);
    expect(hb.run.progress).toEqual({ step: 'writing' });

    const done = await svc.completeWorkerRun({ orgId: ORG, id: run.id, workerId: 'laptop-1', result: { prs: 2 } });

    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ prs: 2 });
  });

  it('records what sort of run it was, which model did it, and the worker\'s summary (migration 0092)', async () => {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'board', kind: 'board', model: 'claude-fable-5-1' });

    expect(run.kind).toBe('board');
    expect(run.model).toBe('claude-fable-5-1');

    const plain = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'writer' });

    expect(plain.kind).toBe('worker');
    expect(plain.model).toBeNull();

    await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w' });
    // The model that actually reported usage wins over the create-time guess.
    const hb = await svc.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w', usage: { model: 'claude-opus-5', inputTokens: 10, outputTokens: 5, cents: 3 } });

    expect(hb.run.model).toBe('claude-opus-5');

    const done = await svc.completeWorkerRun({ orgId: ORG, id: run.id, workerId: 'w', summary: 'Closed the queue to three items.', counts: { prs_merged: 2 } });

    expect(done.summary).toBe('Closed the queue to three items.');
    expect(done.counts).toEqual({ prs_merged: 2 });

    expect(await svc.listWorkerRuns(ORG, { kind: 'board' })).toHaveLength(1);
    expect(svc.parseWorkerRunKind('red-team')).toBe('red-team');
    expect(svc.parseWorkerRunKind('referee')).toBeNull();
  });

  it('refuses a claim on a run someone else holds, and a heartbeat from a stranger', async () => {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo' });
    await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'a' });

    await expect(svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'b' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(svc.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'b' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('tells the worker to stop when the cap is spent or a human cancels, and records cancelled', async () => {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo', capCents: 100 });
    await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w' });
    const overCap = await svc.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w', usage: { model: 'm', cents: 150 } });

    expect(overCap.stop).toBe(true);
    expect(overCap.capRemainingCents).toBe(0);

    const run2 = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo' });
    await svc.claimWorkerRun({ orgId: ORG, id: run2.id, workerId: 'w' });
    const asked = await svc.cancelWorkerRun(ORG, run2.id);

    expect(asked.stopRequested).toBe(true);
    expect(asked.status).toBe('running');

    const hb = await svc.heartbeatWorkerRun({ orgId: ORG, id: run2.id, workerId: 'w' });

    expect(hb.stop).toBe(true);

    const ended = await svc.completeWorkerRun({ orgId: ORG, id: run2.id, workerId: 'w' });

    expect(ended.status).toBe('cancelled');
  });

  it('reaps a run whose lease lapsed, and lets a worker re-claim it with attempt+1', async () => {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo', leaseSeconds: 30 });
    await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1' });
    const future = new Date(Date.now() + 60_000);

    expect(await svc.reapLostWorkerRuns(future)).toBe(1);

    const lost = await svc.getWorkerRun(ORG, run.id);

    expect(lost!.status).toBe('lost');
    expect(lost!.error).toMatch(/lease expired/);

    const { run: reclaimed } = await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w2' });

    expect(reclaimed.status).toBe('running');
    expect(reclaimed.attempt).toBe(2);
    expect(reclaimed.workerId).toBe('w2');
  });

  it('scopes everything by org', async () => {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo' });

    expect(await svc.getWorkerRun('other_org', run.id)).toBeNull();
    await expect(svc.claimWorkerRun({ orgId: 'other_org', id: run.id, workerId: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await svc.listWorkerRuns('other_org')).toEqual([]);
    expect((await svc.listWorkerRuns(ORG)).map(r => r.id)).toEqual([run.id]);
  });
});

// A run queued FOR A RECORD writes what it cost onto that record when it
// ends, and the rollups the org's object types declare follow. The record is
// the durable thing a person reads; the run is the lease underneath it.
describe('WorkerRunService — what a run cost lands on the record it ran for', () => {
  const typeIds: Record<string, number> = {};
  let dir: string;
  let prevPath: string | undefined;

  async function seedObject(type: string, title: string, metadata: Record<string, unknown>): Promise<number> {
    const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: typeIds[type]!, title, metadata }).returning({ id: businessObjectSchema.id });
    return row!.id;
  }

  async function metaOf(id: number): Promise<Record<string, unknown>> {
    const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
    return row!.metadata ?? {};
  }

  async function runFor(taskId: number, cents: number, opts: { capCents?: number; end?: 'complete' | 'fail' } = {}): Promise<void> {
    const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', capCents: opts.capCents, input: { message: 'do it', record: { type: 'engineering_task', id: taskId } } });
    await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w' });
    await svc.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w', usage: { model: 'm', inputTokens: 10, outputTokens: 5, cents } });
    if (opts.end === 'fail') {
      await svc.failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w', error: 'checks failed' });
    } else {
      await svc.completeWorkerRun({ orgId: ORG, id: run.id, workerId: 'w', result: { pr_url: 'https://example.test/pr/1' } });
    }
  }

  beforeEach(async () => {
    prevPath = process.env.WORKSPACE_PATH;
    // The declarations come from the real plugin's type files, so this also
    // proves objects/request/type.yaml and objects/release/type.yaml say
    // what the README says they say.
    dir = mkdtempSync(join(tmpdir(), 'worker-run-cost-'));
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: t\nname: t\nplugins: [software-factory]\n');
    process.env.WORKSPACE_PATH = dir;
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
    for (const slug of ['request', 'engineering_task', 'release']) {
      const [row] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug, label: slug }).returning({ id: businessObjectTypeSchema.id });
      typeIds[slug] = row!.id;
    }
  });

  afterEach(() => {
    if (prevPath === undefined) {
      delete process.env.WORKSPACE_PATH;
    } else {
      process.env.WORKSPACE_PATH = prevPath;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes actual, keeps the estimate, computes the variance, and rolls up onto the request and the release', async () => {
    const request = await seedObject('request', 'Search is slow', { kind: 'bug', tags: ['search'] });
    const task = await seedObject('engineering_task', 'Index the table', { requestId: request, estimateCents: 500 });
    const sibling = await seedObject('engineering_task', 'Warm the cache', { requestId: request, estimateCents: 300, actualCents: 100, varianceCents: -200 });
    const release = await seedObject('release', 'v1.2.0', { taskIds: [task, sibling] });

    await runFor(task, 420);

    const taskMeta = await metaOf(task);

    expect(taskMeta).toMatchObject({ requestId: request, estimateCents: 500, actualCents: 420, varianceCents: -80 });
    expect(typeof taskMeta.costUpdatedAt).toBe('string');
    // The request is the sum over both tasks; the release too, through taskIds.
    expect(await metaOf(request)).toMatchObject({ kind: 'bug', tags: ['search'], estimateCents: 800, actualCents: 520, varianceCents: -280, taskCount: 2 });
    expect(await metaOf(release)).toMatchObject({ taskIds: [task, sibling], estimateCents: 800, actualCents: 520, varianceCents: -280 });
  });

  it('charges every attempt once — a failed run counts, a second run adds, and the figure is a sum over rows', async () => {
    const request = await seedObject('request', 'r', {});
    const task = await seedObject('engineering_task', 't', { requestId: request });

    await runFor(task, 150, { end: 'fail', capCents: 1000 });

    // No estimate on the task: the cap stands in, and says so by being there.
    expect(await metaOf(task)).toMatchObject({ actualCents: 150, estimateCents: 1000, varianceCents: -850 });

    await runFor(task, 200);

    expect(await metaOf(task)).toMatchObject({ actualCents: 350, estimateCents: 1000, varianceCents: -650 });
    expect(await metaOf(request)).toMatchObject({ actualCents: 350, estimateCents: 1000, taskCount: 1 });
  });

  it('a run with no record, or a record that is not there, lands on nothing and still completes', async () => {
    const task = await seedObject('engineering_task', 't', {});
    const plain = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo', input: { message: 'go' } });
    await svc.claimWorkerRun({ orgId: ORG, id: plain.id, workerId: 'w' });
    await svc.heartbeatWorkerRun({ orgId: ORG, id: plain.id, workerId: 'w', usage: { model: 'm', cents: 50 } });

    expect((await svc.completeWorkerRun({ orgId: ORG, id: plain.id, workerId: 'w' })).status).toBe('completed');
    expect(await metaOf(task)).toEqual({});

    const ghost = await svc.createWorkerRun({ orgId: ORG, agentSlug: 'ceo', input: { record: { type: 'engineering_task', id: 999_999 } } });
    await svc.claimWorkerRun({ orgId: ORG, id: ghost.id, workerId: 'w' });

    expect((await svc.completeWorkerRun({ orgId: ORG, id: ghost.id, workerId: 'w' })).status).toBe('completed');
    expect(svc.runRecord({ input: { record: { type: 'engineering_task', id: '12' } } })).toEqual({ type: 'engineering_task', id: 12 });
    expect(svc.runRecord({ input: { record: { type: '', id: 12 } } })).toBeNull();
    expect(svc.runRecord({ input: { task: { task_id: 9 } } })).toBeNull();
  });
});
