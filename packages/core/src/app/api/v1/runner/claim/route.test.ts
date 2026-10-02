/**
 * The installation's runners take the next run from any workspace on it (backlog 052), against
 * PGlite: the installation token, the target the installation declares, the on-box backup's wait,
 * one holder when two runners race, and the run token that then acts for that one workspace.
 * Every name, id and secret is invented.
 */
import process from 'node:process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';
const previous = { token: process.env.VOCION_RUNNER_TOKEN, runners: process.env.VOCION_RUNNERS };
process.env.VOCION_RUNNER_TOKEN = 'installation-fleet-secret';
process.env.VOCION_RUNNERS = JSON.stringify({
  targets: [
    { name: 'aws-fargate', kind: 'aws-fargate', region: 'us-east-1', cluster: 'vocion-runners', taskDefinition: 'vocion-runner', subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'] },
    { name: 'on-box', kind: 'on-box' },
  ],
});

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { workerRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const runs = await import('@/services/WorkerRunService');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { setRepoCredentialSource } = await import('@/services/runners/repoCredential');
const claim = await import('./route');

const NORTHWIND = 'org_runner_northwind';
const KESTREL = 'org_runner_kestrel';

function post(body: unknown, token = 'installation-fleet-secret') {
  return claim.POST(new Request('https://vocion.test/api/v1/runner/claim', { method: 'POST', headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

async function queued(orgId: string, minutesAgo: number, repo = 'https://github.com/example/northwind-portal.git') {
  const run = await runs.createWorkerRun({ orgId, agentSlug: 'task-engineer', input: { task: { task_id: 't', repo }, record: { type: 'work_item', id: 7 } } });
  await db.update(workerRunSchema).set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(workerRunSchema.id, run.id));
  return run;
}

beforeEach(async () => {
  await db.delete(workerRunSchema);
  setRepoCredentialSource(async (_orgId, fullName) => (fullName === 'example/northwind-portal' ? { token: 'repo-token-for-test', source: 'test' } : null));
});

afterAll(() => {
  process.env.VOCION_RUNNER_TOKEN = previous.token;
  process.env.VOCION_RUNNERS = previous.runners;
});

describe('POST /api/v1/runner/claim', () => {
  it('takes only the installation token, and only for a target the installation declares', async () => {
    expect((await post({ target: 'on-box', workerId: 'w1' }, 'vcn_live_a_b')).status).toBe(401);
    expect((await post({ target: 'azure', workerId: 'w1' })).status).toBe(403);
    expect((await post({ target: 'on-box' })).status).toBe(400);
  });

  it('claims the oldest run from any workspace, names the target on it, and hands over a run token and the repo credential', async () => {
    const older = await queued(KESTREL, 10);
    await queued(NORTHWIND, 5);

    const res = await post({ target: 'aws-fargate', workerId: 'aws-fargate-task1-1', workerVersion: 'abc123' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.run).toMatchObject({ id: older.id, orgId: KESTREL, status: 'running', workerTarget: 'aws-fargate', workerVersion: 'abc123' });
    expect(body.git).toEqual({ token: 'repo-token-for-test', source: 'test' });

    // The run token acts for that one workspace, and nothing wider.
    const identity = await authenticateBearer(`Bearer ${body.runToken}`);

    expect(identity).toMatchObject({ orgId: KESTREL, tokenId: `run-${older.id}` });
  });

  it('as the backup, waits RUNNER_CLAIM_AFTER before taking a run the cloud has not', async () => {
    const fresh = await queued(NORTHWIND, 1);

    expect((await post({ target: 'on-box', workerId: 'on-box-1', claimAfterSeconds: 120 })).status).toBe(204);

    await db.update(workerRunSchema).set({ createdAt: new Date(Date.now() - 3 * 60_000) }).where(eq(workerRunSchema.id, fresh.id));
    const res = await post({ target: 'on-box', workerId: 'on-box-1', claimAfterSeconds: 120 });

    expect(res.status).toBe(200);
    expect((await res.json()).run).toMatchObject({ id: fresh.id, workerTarget: 'on-box' });
  });

  it('claims the one run it was started for, and nothing when that run is taken', async () => {
    await queued(NORTHWIND, 10);
    const mine = await queued(NORTHWIND, 1);

    const res = await post({ target: 'aws-fargate', workerId: 'aws-fargate-task2-1', runId: mine.id });

    expect((await res.json()).run.id).toBe(mine.id);
    expect((await post({ target: 'aws-fargate', workerId: 'aws-fargate-task3-1', runId: mine.id })).status).toBe(204);
  });

  it('gives a run to one of two runners that race for it', async () => {
    const run = await queued(NORTHWIND, 10);

    const [a, b] = await Promise.all([
      runs.claimWorkerRun({ orgId: NORTHWIND, id: run.id, workerId: 'on-box-1', target: 'on-box' }).then(() => 'claimed', () => 'refused'),
      runs.claimWorkerRun({ orgId: NORTHWIND, id: run.id, workerId: 'aws-fargate-1', target: 'aws-fargate' }).then(() => 'claimed', () => 'refused'),
    ]);

    expect([a, b].sort()).toEqual(['claimed', 'refused']);
  });
});
