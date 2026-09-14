import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { workerRunSchema } = await import('@/models/Schema');
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
