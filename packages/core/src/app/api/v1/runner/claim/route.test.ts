/**
 * Runners take the next run they may build (backlog 052; scoped per tenant in Vocion 5.1), against
 * PGlite: the installation token on a single-tenant installation, unchanged; an account's runner
 * token, which never reaches another account's run; a start token, which claims its own run and
 * nothing else; a run token, which claims nothing; and a workspace's target, which only that
 * target takes. Every name, id and secret is invented.
 */
import process from 'node:process';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';
const previous = { token: process.env.VOCION_RUNNER_TOKEN, runners: process.env.VOCION_RUNNERS, multi: process.env.VOCION_MULTI_TENANT };
process.env.VOCION_RUNNER_TOKEN = 'installation-fleet-secret';
process.env.VOCION_RUNNERS = JSON.stringify({
  targets: [
    { name: 'aws-fargate', kind: 'aws-fargate', region: 'us-east-1', cluster: 'vocion-runners', taskDefinition: 'vocion-runner', subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'] },
    { name: 'kestrel-fargate', kind: 'aws-fargate', region: 'us-east-1', cluster: 'kestrel-runners', taskDefinition: 'vocion-runner', subnets: ['subnet-0fff5555aaaa6666b'], securityGroups: ['sg-0bbb7777cccc8888d'] },
    { name: 'on-box', kind: 'on-box' },
  ],
});

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
// Queueing a run pushes it to the Fargate target; the ECS call is doubled so no test reaches AWS.
vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: class {
    send = async () => ({ tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:000000000000:task/vocion-runners/test0001' }] });
  },
  RunTaskCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

const { db } = await import('@/libs/DB');
const { projectSchema, runnerTokenSchema, tenantAccountSchema, workerRunSchema } = await import('@/models/Schema');
const { eq, inArray } = await import('drizzle-orm');
const runs = await import('@/services/WorkerRunService');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { mintRunnerToken, revokeRunnerToken } = await import('@/services/runners/runnerTokens');
const { signRunToken, signStartToken, verifyRunToken } = await import('@/services/runners/runToken');
const { setRepoCredentialSource } = await import('@/services/runners/repoCredential');
const claim = await import('./route');

// Two companies on one host, as on Vocion Cloud. Northwind has two workspaces.
const NORTHWIND = 'acct_runner_northwind';
const KESTREL = 'acct_runner_kestrel';
const NW_FACTORY = 'org_runner_northwind';
const NW_LABS = 'org_runner_northwind_labs';
const KC_FACTORY = 'org_runner_kestrel';
const LEGACY = 'org_runner_legacy_no_project';

function post(body: unknown, token = 'installation-fleet-secret') {
  return claim.POST(new Request('https://vocion.test/api/v1/runner/claim', { method: 'POST', headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

async function queued(orgId: string, minutesAgo: number, repo = 'https://github.com/example/northwind-portal.git') {
  const run = await runs.createWorkerRun({ orgId, agentSlug: 'task-engineer', input: { task: { task_id: 't', repo }, record: { type: 'work_item', id: 7 } } });
  await db.update(workerRunSchema).set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(workerRunSchema.id, run.id));
  return run;
}

async function seedTenants() {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-runner-claim' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-runner-claim' },
  ]);
  await db.insert(projectSchema).values([
    { id: NW_FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Northwind factory' },
    { id: NW_LABS, accountId: NORTHWIND, slug: 'labs', name: 'Northwind labs' },
    { id: KC_FACTORY, accountId: KESTREL, slug: 'factory', name: 'Kestrel factory' },
  ]);
}

beforeEach(async () => {
  await db.delete(workerRunSchema);
  await db.delete(runnerTokenSchema);
  await db.delete(projectSchema).where(inArray(projectSchema.id, [NW_FACTORY, NW_LABS, KC_FACTORY]));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, [NORTHWIND, KESTREL]));
  await seedTenants();
  setRepoCredentialSource(async (_orgId, fullName) => (fullName === 'example/northwind-portal' ? { token: 'repo-token-for-test', source: 'test' } : null));
});

afterEach(() => {
  delete process.env.VOCION_MULTI_TENANT;
});

afterAll(() => {
  process.env.VOCION_RUNNER_TOKEN = previous.token;
  process.env.VOCION_RUNNERS = previous.runners;
  process.env.VOCION_MULTI_TENANT = previous.multi;
});

describe('POST /api/v1/runner/claim, single-tenant (unchanged)', () => {
  it('takes only a runner credential, and only for a target the installation declares', async () => {
    expect((await post({ target: 'on-box', workerId: 'w1' }, 'vcn_live_a_b')).status).toBe(401);
    expect((await post({ target: 'azure', workerId: 'w1' })).status).toBe(403);
    expect((await post({ target: 'on-box' })).status).toBe(400);
  });

  it('claims the oldest run from any workspace, names the target on it, and hands over a run token and the repo credential', async () => {
    const older = await queued(KC_FACTORY, 10);
    await queued(NW_FACTORY, 5);

    const res = await post({ target: 'aws-fargate', workerId: 'aws-fargate-task1-1', workerVersion: 'abc123' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.run).toMatchObject({ id: older.id, orgId: KC_FACTORY, status: 'running', workerTarget: 'aws-fargate', workerVersion: 'abc123' });
    expect(body.git).toEqual({ token: 'repo-token-for-test', source: 'test' });
    // No workspace-wide agent-tools claim: the runner calls no agent tool.
    expect(body.toolClaim).toBeUndefined();

    // The run token is for that one run, held by this runner.
    expect(verifyRunToken(body.runToken)).toMatchObject({ use: 'run', orgId: KC_FACTORY, runId: older.id, workerId: 'aws-fargate-task1-1' });
    // And it is no general credential: the write API's and the MCP server's bearer path refuse it.
    expect(await authenticateBearer(`Bearer ${body.runToken}`)).toBeNull();
  });

  it('still claims a run whose workspace has no project row, as it always did', async () => {
    const legacy = await queued(LEGACY, 3);

    const res = await post({ target: 'on-box', workerId: 'on-box-1' });

    expect((await res.json()).run.id).toBe(legacy.id);
  });

  it('as the backup, waits RUNNER_CLAIM_AFTER before taking a run the cloud has not', async () => {
    const fresh = await queued(NW_FACTORY, 1);

    expect((await post({ target: 'on-box', workerId: 'on-box-1', claimAfterSeconds: 120 })).status).toBe(204);

    await db.update(workerRunSchema).set({ createdAt: new Date(Date.now() - 3 * 60_000) }).where(eq(workerRunSchema.id, fresh.id));
    const res = await post({ target: 'on-box', workerId: 'on-box-1', claimAfterSeconds: 120 });

    expect(res.status).toBe(200);
    expect((await res.json()).run).toMatchObject({ id: fresh.id, workerTarget: 'on-box' });
  });

  it('claims the one run it was started for, and nothing when that run is taken', async () => {
    await queued(NW_FACTORY, 10);
    const mine = await queued(NW_FACTORY, 1);

    const res = await post({ target: 'aws-fargate', workerId: 'aws-fargate-task2-1', runId: mine.id });

    expect((await res.json()).run.id).toBe(mine.id);
    expect((await post({ target: 'aws-fargate', workerId: 'aws-fargate-task3-1', runId: mine.id })).status).toBe(204);
  });

  it('gives a run to one of two runners that race for it', async () => {
    const run = await queued(NW_FACTORY, 10);

    const [a, b] = await Promise.all([
      runs.claimWorkerRun({ orgId: NW_FACTORY, id: run.id, workerId: 'on-box-1', target: 'on-box' }).then(() => 'claimed', () => 'refused'),
      runs.claimWorkerRun({ orgId: NW_FACTORY, id: run.id, workerId: 'aws-fargate-1', target: 'aws-fargate' }).then(() => 'claimed', () => 'refused'),
    ]);

    expect([a, b].sort()).toEqual(['claimed', 'refused']);
  });
});

describe('an account\'s runner token', () => {
  it('never claims another account\'s run: not the oldest, not by id, not after its own are gone', async () => {
    const kestrelRun = await queued(KC_FACTORY, 30); // the oldest on the host
    const northwindRun = await queued(NW_FACTORY, 5);
    const { token } = await mintRunnerToken({ accountId: NORTHWIND, name: 'Northwind on-box' });

    const first = await post({ target: 'on-box', workerId: 'nw-runner-1' }, token);

    expect(first.status).toBe(200);
    expect((await first.json()).run).toMatchObject({ id: northwindRun.id, orgId: NW_FACTORY });

    // Kestrel's run is queued and the oldest, and still nothing for Northwind's token.
    expect((await post({ target: 'on-box', workerId: 'nw-runner-2' }, token)).status).toBe(204);
    expect((await post({ target: 'on-box', workerId: 'nw-runner-2', runId: kestrelRun.id }, token)).status).toBe(204);

    const [still] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, kestrelRun.id));

    expect(still).toMatchObject({ status: 'queued', workerId: null });

    // Kestrel's own token takes it.
    const kestrel = await mintRunnerToken({ accountId: KESTREL, name: 'Kestrel fleet' });

    expect((await (await post({ target: 'on-box', workerId: 'kc-runner-1' }, kestrel.token)).json()).run.id).toBe(kestrelRun.id);
  });

  it('narrowed to some workspaces, claims nothing from the account\'s others', async () => {
    const labs = await queued(NW_LABS, 10);
    const factory = await queued(NW_FACTORY, 5);
    const { token } = await mintRunnerToken({ accountId: NORTHWIND, name: 'Factory only', projectIds: [NW_FACTORY] });

    expect((await (await post({ target: 'on-box', workerId: 'nw-1' }, token)).json()).run.id).toBe(factory.id);
    expect((await post({ target: 'on-box', workerId: 'nw-2', runId: labs.id }, token)).status).toBe(204);
  });

  it('cannot be minted naming another account\'s workspace', async () => {
    await expect(mintRunnerToken({ accountId: NORTHWIND, name: 'Overreach', projectIds: [NW_FACTORY, KC_FACTORY] })).rejects.toThrow(/only name this account's own workspaces/);
  });

  it('claims nothing once revoked or expired, and a forged secret claims nothing', async () => {
    await queued(NW_FACTORY, 5);
    const { id, token } = await mintRunnerToken({ accountId: NORTHWIND, name: 'Northwind on-box' });
    await revokeRunnerToken(NORTHWIND, id);

    expect((await post({ target: 'on-box', workerId: 'w' }, token)).status).toBe(401);

    const expiring = await mintRunnerToken({ accountId: NORTHWIND, name: 'Short', expiresAt: new Date(Date.now() + 60_000) });
    await db.update(runnerTokenSchema).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(runnerTokenSchema.id, expiring.id));

    expect((await post({ target: 'on-box', workerId: 'w' }, expiring.token)).status).toBe(401);

    const live = await mintRunnerToken({ accountId: NORTHWIND, name: 'Live' });

    expect((await post({ target: 'on-box', workerId: 'w' }, `${live.token.slice(0, -4)}0000`)).status).toBe(401);
  });

  it('does not claim a run whose workspace has no account to check it against', async () => {
    await queued(LEGACY, 10);
    const { token } = await mintRunnerToken({ accountId: NORTHWIND, name: 'Northwind on-box' });

    expect((await post({ target: 'on-box', workerId: 'w' }, token)).status).toBe(204);
  });
});

describe('a multi-tenant installation (VOCION_MULTI_TENANT=1)', () => {
  it('refuses the installation runner token and says what to use instead; an account token still claims', async () => {
    process.env.VOCION_MULTI_TENANT = '1';
    const run = await queued(NW_FACTORY, 5);

    const refused = await post({ target: 'on-box', workerId: 'w' });

    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toMatch(/serves several accounts .* runner token/);

    const [untouched] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, run.id));

    expect(untouched!.status).toBe('queued');

    const { token } = await mintRunnerToken({ accountId: NORTHWIND, name: 'Northwind on-box' });

    expect((await (await post({ target: 'on-box', workerId: 'w' }, token)).json()).run.id).toBe(run.id);
  });
});

describe('a run token and a start token', () => {
  it('a run token claims nothing: not the queue, not its own run, not another', async () => {
    const run = await queued(NW_FACTORY, 5);
    const other = await queued(NW_FACTORY, 4);
    const runToken = signRunToken({ orgId: NW_FACTORY, runId: run.id, target: 'on-box', workerId: 'on-box-1' });

    for (const body of [{}, { runId: run.id }, { runId: other.id }]) {
      expect((await post({ target: 'on-box', workerId: 'w', ...body }, runToken)).status).toBe(403);
    }

    expect((await db.select().from(workerRunSchema).where(eq(workerRunSchema.status, 'queued'))).length).toBe(2);
  });

  it('a start token claims its own run, as its own target, once, and trades itself for that run\'s token', async () => {
    await queued(NW_FACTORY, 30);
    const mine = await queued(NW_FACTORY, 1);
    const kestrelRun = await queued(KC_FACTORY, 40);
    const start = signStartToken({ orgId: NW_FACTORY, runId: mine.id, target: 'aws-fargate' });

    // Not another run, not as another target.
    expect((await post({ target: 'aws-fargate', workerId: 'task-1', runId: kestrelRun.id }, start)).status).toBe(403);
    expect((await post({ target: 'on-box', workerId: 'task-1' }, start)).status).toBe(403);

    const res = await post({ target: 'aws-fargate', workerId: 'task-1', claimAfterSeconds: 600 }, start);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.run.id).toBe(mine.id);
    expect(verifyRunToken(body.runToken)).toMatchObject({ use: 'run', runId: mine.id, workerId: 'task-1' });
    expect((await post({ target: 'aws-fargate', workerId: 'task-2' }, start)).status).toBe(204);
  });

  it('a start token for a run that has since been claimed elsewhere gets nothing', async () => {
    const run = await queued(NW_FACTORY, 5);
    await runs.claimWorkerRun({ orgId: NW_FACTORY, id: run.id, workerId: 'on-box-1', target: 'on-box' });

    expect((await post({ target: 'aws-fargate', workerId: 'task-1' }, signStartToken({ orgId: NW_FACTORY, runId: run.id, target: 'aws-fargate' }))).status).toBe(204);
  });
});

describe('a workspace that names the target serving it', () => {
  it('is claimed only by that target; its account\'s choice covers the workspaces that name none', async () => {
    await db.update(projectSchema).set({ runnerTarget: 'kestrel-fargate' }).where(eq(projectSchema.id, KC_FACTORY));
    const kestrelRun = await queued(KC_FACTORY, 10);
    const northwindRun = await queued(NW_FACTORY, 5);

    // The shared on-box runner passes over Kestrel's older run and takes Northwind's.
    expect((await (await post({ target: 'on-box', workerId: 'shared-1' })).json()).run.id).toBe(northwindRun.id);
    expect((await post({ target: 'on-box', workerId: 'shared-2' })).status).toBe(204);
    expect((await (await post({ target: 'kestrel-fargate', workerId: 'kc-1' })).json()).run.id).toBe(kestrelRun.id);

    // Northwind's account names a target; the workspace naming none follows it.
    await db.update(tenantAccountSchema).set({ runnerTarget: 'aws-fargate' }).where(eq(tenantAccountSchema.id, NORTHWIND));
    const labs = await queued(NW_LABS, 3);

    expect((await post({ target: 'on-box', workerId: 'shared-3' })).status).toBe(204);
    expect((await (await post({ target: 'aws-fargate', workerId: 'nw-cloud-1' })).json()).run.id).toBe(labs.id);
  });
});
