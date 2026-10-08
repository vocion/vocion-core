/**
 * A runner is started for a run at dispatch on the installation's Fargate target (backlog 052),
 * against PGlite with the ECS call doubled. Since 5.1 the started task carries a start token for
 * its one run and no other Vocion credential, and a workspace that names its target is started
 * only there. Every id is invented.
 */
import process from 'node:process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
const previousFleet = process.env.VOCION_RUNNER_TOKEN;
process.env.VOCION_RUNNER_TOKEN = 'installation-fleet-secret-never-in-a-task';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, workerRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { fargateRunTaskInput, startRunnerFor } = await import('./targets');
const { verifyRunToken } = await import('./runToken');
const { authorizeRunToken } = await import('./runTokenAccess');

const FARGATE = { name: 'aws-fargate', kind: 'aws-fargate' as const, region: 'us-east-1', cluster: 'vocion-runners', taskDefinition: 'vocion-runner', taskDefinitionWithDb: 'vocion-runner-db', subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'], assignPublicIp: true, containerName: 'runner' };
const KESTREL_FARGATE = { ...FARGATE, name: 'kestrel-fargate', cluster: 'kestrel-runners', subnets: ['subnet-0fff5555aaaa6666b'], securityGroups: ['sg-0bbb7777cccc8888d'] };
const ON_BOX = { name: 'on-box', kind: 'on-box' as const };
const ORG = 'org_runner_start';
const ACCOUNT = 'acct_runner_start';

type Overrides = { containerOverrides: Array<{ name: string; environment: Array<{ name: string; value: string }> }> };
const envOf = (input: Record<string, unknown>) => (input.overrides as Overrides).containerOverrides[0]!.environment;

async function queued(input: Record<string, unknown>, orgId = ORG) {
  const [row] = await db.insert(workerRunSchema).values({ orgId, agentSlug: 'task-engineer', kind: 'worker', input }).returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(workerRunSchema);
  await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, ACCOUNT));
});

afterAll(() => {
  process.env.VOCION_RUNNER_TOKEN = previousFleet;
});

describe('a runner is started for a run', () => {
  it('asks ECS for one task told its run id, in the installation\'s network, and a database task when the contract names one', () => {
    const input = fargateRunTaskInput(FARGATE, { id: 41, orgId: ORG, input: { task: { environment: { services: [{ name: 'postgres', url: 'postgresql://runner:runner@localhost:5432/portal' }] } } } });

    expect(input).toMatchObject({
      cluster: 'vocion-runners',
      taskDefinition: 'vocion-runner-db',
      launchType: 'FARGATE',
      networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'], assignPublicIp: 'ENABLED' } },
      startedBy: 'vocion-run-41',
    });
    expect((input.overrides as Overrides).containerOverrides[0]!.name).toBe('runner');
    expect(envOf(input).filter(e => e.name !== 'VOCION_RUN_TOKEN')).toEqual([{ name: 'WORKER_RUN_ID', value: '41' }, { name: 'RUNNER_TARGET', value: 'aws-fargate' }, { name: 'RUNNER_CLAIM_AFTER', value: '0' }]);
    expect(fargateRunTaskInput(FARGATE, { id: 42, orgId: ORG, input: {} }).taskDefinition).toBe('vocion-runner');
    expect(fargateRunTaskInput({ ...FARGATE, capacityProvider: 'FARGATE_SPOT' }, { id: 42, orgId: ORG, input: {} })).toMatchObject({ capacityProviderStrategy: [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }] });
  });

  it('puts only a start token for that one run into the container, never a token that can claim other runs', async () => {
    const run = await queued({ task: {} });
    const input = fargateRunTaskInput(FARGATE, run);
    const env = envOf(input);

    // The one credential in the overrides.
    expect(env.map(e => e.name)).toEqual(['WORKER_RUN_ID', 'RUNNER_TARGET', 'RUNNER_CLAIM_AFTER', 'VOCION_RUN_TOKEN']);

    const token = env.find(e => e.name === 'VOCION_RUN_TOKEN')!.value;

    expect(verifyRunToken(token)).toMatchObject({ use: 'start', orgId: ORG, runId: run.id, target: 'aws-fargate' });

    // No long-lived credential anywhere in what ECS is told: not the installation's, not an
    // account's runner token, not a workspace API token.
    const wire = JSON.stringify(input);

    expect(wire).not.toContain('installation-fleet-secret-never-in-a-task');
    expect(wire).not.toContain('vcn_runner_');
    expect(wire).not.toContain('vcn_live_');
    expect(env.some(e => e.name === 'VOCION_RUNNER_TOKEN' || e.name === 'VOCION_TOKEN')).toBe(false);

    // And the start token is no callback credential either: it cannot report on its own run.
    const verdict = await authorizeRunToken(token, { method: 'POST', url: `https://vocion.test/api/v1/worker-runs/${run.id}/heartbeat` });

    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  it('writes on the run which task it started', async () => {
    const run = await queued({ task: {} });
    const runTask = vi.fn().mockResolvedValue({ tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:000000000000:task/vocion-runners/abc123def' }] });

    const out = await startRunnerFor(run, { targets: [FARGATE, ON_BOX], runTask });

    expect(out).toEqual({ started: true, target: 'aws-fargate', ref: 'abc123def' });
    expect(runTask).toHaveBeenCalledWith(expect.objectContaining({ cluster: 'vocion-runners' }), 'us-east-1');

    const [row] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, run.id));

    expect((row!.progress as { note: string }).note).toBe('Started a runner on aws-fargate (task abc123def); it claims the run when it boots.');
  });

  it('says why a start failed and who takes the run instead, and never throws', async () => {
    const run = await queued({ task: {} });
    const refused = await startRunnerFor(run, { targets: [FARGATE, ON_BOX], runTask: vi.fn().mockResolvedValue({ tasks: [], failures: [{ reason: 'RESOURCE:MEMORY' }] }) });

    expect(refused).toEqual({ started: false, target: 'aws-fargate', reason: 'RESOURCE:MEMORY' });

    const [row] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, run.id));

    expect((row!.progress as { note: string }).note).toBe('Could not start a runner on aws-fargate: RESOURCE:MEMORY. The on-box runner takes the run once it has waited.');
    expect(await startRunnerFor(run, { targets: [FARGATE], runTask: vi.fn().mockRejectedValue(new Error('AccessDeniedException: not authorized to perform ecs:RunTask')) })).toMatchObject({ started: false, reason: 'AccessDeniedException: not authorized to perform ecs:RunTask' });
  });

  it('starts nothing where the installation only polls, or for a run that is not an engineering run', async () => {
    const runTask = vi.fn();

    expect(await startRunnerFor(await queued({}), { targets: [ON_BOX], runTask })).toBeNull();
    expect(await startRunnerFor({ id: 9, orgId: ORG, kind: 'lead', input: {} }, { targets: [FARGATE], runTask })).toBeNull();
    expect(runTask).not.toHaveBeenCalled();
  });
});

describe('a workspace that names the target serving it', () => {
  async function workspace(target: { workspace?: string | null; account?: string | null }) {
    await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Kestrel Capital', slug: 'kestrel-capital-runner-start', runnerTarget: target.account ?? null });
    await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'kestrel-factory', name: 'Kestrel factory', runnerTarget: target.workspace ?? null });
  }

  it('is started on that target only, and the note promises no backup elsewhere', async () => {
    await workspace({ workspace: 'kestrel-fargate' });
    const run = await queued({ task: {} });
    const runTask = vi.fn().mockResolvedValue({ tasks: [], failures: [{ reason: 'RESOURCE:CPU' }] });

    expect(await startRunnerFor(run, { targets: [FARGATE, KESTREL_FARGATE, ON_BOX], runTask })).toMatchObject({ started: false, target: 'kestrel-fargate' });
    expect(runTask).toHaveBeenCalledWith(expect.objectContaining({ cluster: 'kestrel-runners' }), 'us-east-1');

    const [row] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, run.id));

    expect((row!.progress as { note: string }).note).toBe('Could not start a runner on kestrel-fargate: RESOURCE:CPU. The scheduled poll takes it.');
  });

  it('follows its account when it names none itself', async () => {
    await workspace({ account: 'kestrel-fargate' });
    const runTask = vi.fn().mockResolvedValue({ tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:000000000000:task/kestrel-runners/fff000' }] });

    expect(await startRunnerFor(await queued({ task: {} }), { targets: [FARGATE, KESTREL_FARGATE], runTask })).toEqual({ started: true, target: 'kestrel-fargate', ref: 'fff000' });
  });

  it('starts nothing when its target polls, and says so when the installation does not declare it', async () => {
    await workspace({ workspace: 'on-box' });
    const runTask = vi.fn();

    expect(await startRunnerFor(await queued({ task: {} }), { targets: [FARGATE, ON_BOX], runTask })).toBeNull();

    await db.update(projectSchema).set({ runnerTarget: 'azure-east' }).where(eq(projectSchema.id, ORG));
    const run = await queued({ task: {} });

    expect(await startRunnerFor(run, { targets: [FARGATE, ON_BOX], runTask })).toMatchObject({ started: false, target: 'azure-east' });
    expect(runTask).not.toHaveBeenCalled();

    const [row] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, run.id));

    expect((row!.progress as { note: string }).note).toMatch(/"azure-east", which this installation does not declare/);
  });
});
