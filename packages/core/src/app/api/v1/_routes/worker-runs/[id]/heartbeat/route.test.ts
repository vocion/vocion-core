/**
 * The step-log contract a worker builds to (backlog 036): heartbeat, complete
 * and fail take `events`, and answer with `eventsAccepted`, the highest seq
 * Vocion has dealt with. A worker that sends none gets the reply it always did.
 */
import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { workerRunEventSchema, workerRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const runs = await import('@/services/WorkerRunService');
const heartbeat = await import('./route');
const complete = await import('../complete/route');
const fail = await import('../fail/route');

const ORG = 'org_heartbeat_events';

function post(id: number, path: string, body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://vocion.test/api/v1/worker-runs/${id}/${path}`, { method: 'POST', headers: { 'authorization': 'Bearer vcn_live_fake', 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: String(id) }) },
  ];
}

const line = (seq: number, phase = 'claude.tool') => ({ seq, ts: '2026-09-28T10:00:00.000Z', phase, fields: { tool: 'Read', target: 'src/a.ts', ok: true } });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: ORG, tokenId: 't1', principal: { kind: 'user', id: 'token:t1', role: 'owner', scope: { orgId: ORG }, grants: ['*'] } } as never);
  await db.delete(workerRunEventSchema);
  await db.delete(workerRunSchema);
});

async function claimed() {
  const run = await runs.createWorkerRun({ orgId: ORG, agentSlug: 'factory-worker', input: {} });
  await runs.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1' });
  return run;
}

describe('POST /api/v1/worker-runs/:id/heartbeat with events', () => {
  it('stores the lines and answers eventsAccepted beside the usual control signals', async () => {
    const run = await claimed();
    const res = await heartbeat.POST(...post(run.id, 'heartbeat', { workerId: 'w1', progress: { phase: 'claude' }, events: [line(1), line(2)] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ stop: false, status: 'running', eventsAccepted: 2 });
    expect(await db.select().from(workerRunEventSchema)).toHaveLength(2);
  });

  it('answers as it always did when the worker sends no lines', async () => {
    const run = await claimed();
    const body = await (await heartbeat.POST(...post(run.id, 'heartbeat', { workerId: 'w1' }))).json();

    expect(body).not.toHaveProperty('eventsAccepted');
    expect(body.stop).toBe(false);
  });
});

describe('the last lines ride with complete and fail', () => {
  it('complete lands them and closes the run', async () => {
    const run = await claimed();
    const res = await complete.POST(...post(run.id, 'complete', { workerId: 'w1', result: { pr_url: 'https://github.com/example/northwind-portal/pull/9', transcriptArtifactId: 91 }, events: [line(1, 'pushed'), line(2, 'pr.opened')] }));
    const body = await res.json();

    expect(body).toMatchObject({ eventsAccepted: 2, run: { status: 'completed', result: { transcriptArtifactId: 91 } } });
  });

  it('fail lands them and keeps what the run kept, links included', async () => {
    const run = await claimed();
    // The worker sends the links at the top level of a fail; `result` only when work was kept.
    const res = await fail.POST(...post(run.id, 'fail', { workerId: 'w1', error: 'verification failed: test', result: { pr_url: 'https://github.com/example/northwind-portal/pull/10' }, transcriptArtifactId: 91, promptArtifactId: 92, logLinks: { stream: 'https://logs.example/1', checks: { test: 'https://logs.example/1/test' } }, events: [line(1, 'verify.failed')] }));
    const body = await res.json();

    expect(body).toMatchObject({ eventsAccepted: 1, run: { status: 'failed', result: { pr_url: 'https://github.com/example/northwind-portal/pull/10', transcriptArtifactId: 91, promptArtifactId: 92, logLinks: { stream: 'https://logs.example/1', checks: { test: 'https://logs.example/1/test' } } } } });
  });

  it('a bare fail leaves the result alone', async () => {
    const run = await claimed();
    const body = await (await fail.POST(...post(run.id, 'fail', { workerId: 'w1', error: 'claude exited 1' }))).json();

    expect(body.run.result).toBeNull();
    expect(body).not.toHaveProperty('eventsAccepted');
  });
});
