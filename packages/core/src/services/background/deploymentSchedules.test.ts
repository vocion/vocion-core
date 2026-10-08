/**
 * Which deployment-wide schedules exist, and when. Creating them on DBOS is
 * the engine's job; this is the list the executor applies on start.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ workers: false, langfuse: { enabled: true, retentionDays: 365 as number | null } }));
vi.mock('@/services/WorkerRunService', () => ({ externalWorkersEnabled: () => flags.workers }));
vi.mock('@/libs/Langfuse', () => ({ langfuseConfig: () => flags.langfuse }));

const { deploymentSchedules, applyDeploymentSchedules } = await import('./deploymentSchedules');
const { listSchedules } = await import('@/libs/durable/jobs');
const { resetMemorySchedules } = await import('@/libs/durable/memory');

afterEach(() => {
  resetMemorySchedules();
  flags.workers = false;
  flags.langfuse = { enabled: true, retentionDays: 365 };
});

describe('deploymentSchedules', () => {
  it('always reaps mission runs, sweeps images and prunes finished job runs', () => {
    const { wanted } = deploymentSchedules();

    expect(wanted.map(s => [s.name, s.cron])).toEqual(expect.arrayContaining([
      ['mission-run-reaper', '*/5 * * * *'],
      ['artifact-image-sweep', '17 * * * *'],
      ['durable-prune', '10 4 * * *'],
      ['needs-you-sweep', '*/5 * * * *'],
    ]));
  });

  it('reaps worker runs only with external workers on', () => {
    expect(deploymentSchedules().unwanted).toContain('worker-run-reaper');

    flags.workers = true;

    expect(deploymentSchedules().wanted.map(s => s.name)).toContain('worker-run-reaper');
  });

  it('prunes Langfuse daily in the small hours, and not at all once retention is off', () => {
    expect(deploymentSchedules().wanted.find(s => s.name === 'langfuse-retention')?.cron).toBe('20 3 * * *');

    flags.langfuse = { enabled: true, retentionDays: null };

    expect(deploymentSchedules().unwanted).toContain('langfuse-retention');
  });

  it('applies idempotently: twice is the same set, and a removed feature loses its schedule', async () => {
    flags.workers = true;
    await applyDeploymentSchedules();
    await applyDeploymentSchedules();

    expect((await listSchedules()).map(s => s.name).sort()).toEqual(
      ['artifact-image-sweep', 'durable-prune', 'langfuse-retention', 'mission-run-reaper', 'needs-you-sweep', 'worker-run-reaper'],
    );

    flags.workers = false;
    await applyDeploymentSchedules();

    expect((await listSchedules()).map(s => s.name)).not.toContain('worker-run-reaper');
  });
});
