/**
 * A runner is started for a run at dispatch on the installation's Fargate target (backlog 052),
 * against PGlite with the ECS call doubled. Every id is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { workerRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { fargateRunTaskInput, startRunnerFor } = await import('./targets');

const FARGATE = { name: 'aws-fargate', kind: 'aws-fargate' as const, region: 'us-east-1', cluster: 'vocion-runners', taskDefinition: 'vocion-runner', taskDefinitionWithDb: 'vocion-runner-db', subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'], assignPublicIp: true, containerName: 'runner' };
const ON_BOX = { name: 'on-box', kind: 'on-box' as const };
const ORG = 'org_runner_start';

async function queued(input: Record<string, unknown>) {
  const [row] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'task-engineer', kind: 'worker', input }).returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(workerRunSchema);
});

describe('a runner is started for a run', () => {
  it('asks ECS for one task told its run id, in the installation\'s network, and a database task when the contract names one', () => {
    const input = fargateRunTaskInput(FARGATE, { id: 41, input: { task: { environment: { services: [{ name: 'postgres', url: 'postgresql://runner:runner@localhost:5432/portal' }] } } } });

    expect(input).toMatchObject({
      cluster: 'vocion-runners',
      taskDefinition: 'vocion-runner-db',
      launchType: 'FARGATE',
      networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-0aaa1111bbbb2222c'], securityGroups: ['sg-0ddd3333eeee4444f'], assignPublicIp: 'ENABLED' } },
      startedBy: 'vocion-run-41',
    });
    expect((input.overrides as { containerOverrides: Array<{ name: string; environment: unknown[] }> }).containerOverrides[0]).toEqual({
      name: 'runner',
      environment: [{ name: 'WORKER_RUN_ID', value: '41' }, { name: 'RUNNER_TARGET', value: 'aws-fargate' }, { name: 'RUNNER_CLAIM_AFTER', value: '0' }],
    });
    expect(fargateRunTaskInput(FARGATE, { id: 42, input: {} }).taskDefinition).toBe('vocion-runner');
    expect(fargateRunTaskInput({ ...FARGATE, capacityProvider: 'FARGATE_SPOT' }, { id: 42, input: {} })).toMatchObject({ capacityProviderStrategy: [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }] });
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
    expect(await startRunnerFor({ id: 9, kind: 'lead', input: {} }, { targets: [FARGATE], runTask })).toBeNull();
    expect(runTask).not.toHaveBeenCalled();
  });
});
