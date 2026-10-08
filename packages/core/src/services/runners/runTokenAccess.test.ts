/**
 * A run token makes its own run's calls and nothing else (Vocion 5.1), against PGlite and the real
 * route handlers: it reports on its run, renews itself on each heartbeat, cannot touch another
 * run, cannot claim, cannot reach the rest of the API, and stops working when its run is over or
 * held by someone else. Every name, id and secret is invented.
 */
import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn().mockResolvedValue({ userId: null, orgId: null }) }));

const { db } = await import('@/libs/DB');
const { workerRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const runs = await import('@/services/WorkerRunService');
const { RUN_TOKEN_AFTERLIFE_MS, authorizeRunToken } = await import('./runTokenAccess');
const { signRunToken, signStartToken, verifyRunToken } = await import('./runToken');
const heartbeat = await import('@/app/api/v1/worker-runs/[id]/heartbeat/route');
const claimById = await import('@/app/api/v1/worker-runs/[id]/claim/route');
const complete = await import('@/app/api/v1/worker-runs/[id]/complete/route');
const listRuns = await import('@/app/api/v1/worker-runs/route');

const NORTHWIND = 'org_runtoken_northwind';
const KESTREL = 'org_runtoken_kestrel';

function req(method: string, path: string, token: string, body?: unknown) {
  return new Request(`https://vocion.test/api/v1${path}`, { method, headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const gate = (token: string, method: string, path: string) => authorizeRunToken(token, { method, url: `https://vocion.test/api/v1${path}` });

/**
 * A claimed run and the run token its claim handed out.
 * @param orgId - The workspace.
 * @param workerId - The runner holding the lease.
 * @param input - The run's input.
 */
async function claimed(orgId: string, workerId: string, input: Record<string, unknown> = { task: { task_id: 't', product: 'northwind-portal' } }) {
  const run = await runs.createWorkerRun({ orgId, agentSlug: 'task-engineer', input });
  await runs.claimWorkerRun({ orgId, id: run.id, workerId, target: 'on-box' });
  return { run, token: signRunToken({ orgId, runId: run.id, target: 'on-box', workerId }) };
}

beforeEach(async () => {
  await db.delete(workerRunSchema);
});

describe('a run token reports on its own run', () => {
  it('heartbeats and completes its run, and each heartbeat hands back a fresh token for the same lease', async () => {
    const { run, token } = await claimed(NORTHWIND, 'on-box-1');

    const beat = await heartbeat.POST(req('POST', `/worker-runs/${run.id}/heartbeat`, token, { workerId: 'on-box-1', progress: { phase: 'engineer' } }), params(run.id));
    const body = await beat.json();

    expect(beat.status).toBe(200);
    expect(verifyRunToken(body.runToken)).toMatchObject({ use: 'run', orgId: NORTHWIND, runId: run.id, workerId: 'on-box-1' });
    expect(body.toolClaim).toBeUndefined();

    const done = await complete.POST(req('POST', `/worker-runs/${run.id}/complete`, body.runToken, { workerId: 'on-box-1', result: { status: 'completed' } }), params(run.id));

    expect(done.status).toBe(200);
  });

  it('may write its task record and QA evidence, and read its own product\'s QA sign-in only', async () => {
    const { token } = await claimed(NORTHWIND, 'on-box-1');

    expect(await gate(token, 'POST', '/objects')).toMatchObject({ ok: true });
    expect(await gate(token, 'POST', '/artifacts')).toMatchObject({ ok: true });
    expect(await gate(token, 'POST', '/artifacts/video?recordId=7')).toMatchObject({ ok: true });
    expect(await gate(token, 'GET', '/products/northwind-portal/access?reveal=1')).toMatchObject({ ok: true });
    expect(await gate(token, 'GET', '/products/kestrel-ledger/access?reveal=1')).toMatchObject({ ok: false, status: 403 });
    // A malformed escape is a refusal, not a server fault.
    expect(await gate(token, 'GET', '/products/%E0%A4%A/access')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('a run token cannot act on another run', () => {
  it('is refused on another run\'s callbacks, in its own workspace or another', async () => {
    const mine = await claimed(NORTHWIND, 'on-box-1');
    const sameWorkspace = await claimed(NORTHWIND, 'on-box-2');
    const otherTenant = await claimed(KESTREL, 'kc-1');

    for (const other of [sameWorkspace.run, otherTenant.run]) {
      for (const call of ['heartbeat', 'complete', 'fail', 'checkpoint']) {
        expect(await gate(mine.token, 'POST', `/worker-runs/${other.id}/${call}`)).toMatchObject({ ok: false, status: 403 });
      }
    }

    const res = await heartbeat.POST(req('POST', `/worker-runs/${sameWorkspace.run.id}/heartbeat`, mine.token, { workerId: 'on-box-2' }), params(sameWorkspace.run.id));

    expect(res.status).toBe(403);

    const [untouched] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, sameWorkspace.run.id));

    expect(untouched!.workerId).toBe('on-box-2');
  });

  it('cannot claim a queued run by id, list the queue, or reach the rest of the API', async () => {
    const mine = await claimed(NORTHWIND, 'on-box-1');
    const waiting = await runs.createWorkerRun({ orgId: NORTHWIND, agentSlug: 'task-engineer', input: {} });

    const res = await claimById.POST(req('POST', `/worker-runs/${waiting.id}/claim`, mine.token, { workerId: 'thief' }), params(waiting.id));

    expect(res.status).toBe(403);
    expect((await listRuns.GET(req('GET', '/worker-runs?status=queued', mine.token))).status).toBe(403);

    const [still] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, waiting.id));

    expect(still!.status).toBe('queued');

    for (const [method, path] of [['GET', '/objects'], ['GET', '/sources'], ['POST', '/reviews/decide'], ['GET', `/worker-runs/${mine.run.id}/../${waiting.id}`], ['POST', '/runner/claim']] as const) {
      expect(await gate(mine.token, method, path)).toMatchObject({ ok: false });
    }
  });

  it('a start token reports on nothing, not even its own run', async () => {
    const run = await runs.createWorkerRun({ orgId: NORTHWIND, agentSlug: 'task-engineer', input: {} });
    const start = signStartToken({ orgId: NORTHWIND, runId: run.id, target: 'aws-fargate' });

    expect(await gate(start, 'POST', `/worker-runs/${run.id}/heartbeat`)).toMatchObject({ ok: false, status: 403 });
    expect(await gate(start, 'POST', '/objects')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('a run token expires', () => {
  it('on its clock', async () => {
    const { run } = await claimed(NORTHWIND, 'on-box-1');
    const stale = signRunToken({ orgId: NORTHWIND, runId: run.id, target: 'on-box', workerId: 'on-box-1' }, -1);

    expect(await gate(stale, 'POST', `/worker-runs/${run.id}/heartbeat`)).toMatchObject({ ok: false, status: 401 });
  });

  it('when another runner holds the run, and when the run was lost', async () => {
    const { run, token } = await claimed(NORTHWIND, 'on-box-1');
    await db.update(workerRunSchema).set({ workerId: 'aws-fargate-9' }).where(eq(workerRunSchema.id, run.id));

    // 409: what every runner image reads as "not yours any more", and stops its engineer on.
    expect(await gate(token, 'POST', `/worker-runs/${run.id}/heartbeat`)).toMatchObject({ ok: false, status: 409 });

    await db.update(workerRunSchema).set({ workerId: 'on-box-1', status: 'lost' }).where(eq(workerRunSchema.id, run.id));

    expect(await gate(token, 'POST', `/worker-runs/${run.id}/heartbeat`)).toMatchObject({ ok: false, status: 409 });
  });

  it('a short while after its run ends: long enough to write the task record, and no longer', async () => {
    const { run, token } = await claimed(NORTHWIND, 'on-box-1');
    const ended = new Date();
    await db.update(workerRunSchema).set({ status: 'completed', completedAt: ended }).where(eq(workerRunSchema.id, run.id));

    expect(await gate(token, 'POST', '/objects')).toMatchObject({ ok: true });
    expect(await authorizeRunToken(token, { method: 'POST', url: 'https://vocion.test/api/v1/objects' }, new Date(ended.getTime() + RUN_TOKEN_AFTERLIFE_MS + 1000))).toMatchObject({ ok: false, status: 409 });
  });

  it('when it names a run in another workspace than its own, it is not believed', async () => {
    const { run } = await claimed(KESTREL, 'kc-1');
    const forgedScope = signRunToken({ orgId: NORTHWIND, runId: run.id, target: 'on-box', workerId: 'kc-1' });

    expect(await gate(forgedScope, 'POST', `/worker-runs/${run.id}/heartbeat`)).toMatchObject({ ok: false, status: 401 });
  });
});
