/**
 * The daily retention Schedule's shape, and when it should exist.
 *
 * Only the pure builder is tested here; creating and deleting a
 * Schedule needs a running Temporal and belongs in the platform
 * integration suite, the same split `SourceScheduleService` uses.
 */
import { describe, expect, it } from 'vitest';
import { LANGFUSE_RETENTION_SCHEDULE_ID, VOCION_WORKFLOWS_TASK_QUEUE } from '@/libs/temporal/client';
import { buildLangfuseRetentionScheduleOptions } from './LangfuseRetentionScheduleService';

describe('buildLangfuseRetentionScheduleOptions', () => {
  it('runs daily, in the small hours', () => {
    const options = buildLangfuseRetentionScheduleOptions();

    expect(options.spec).toEqual({ cronExpressions: ['20 3 * * *'] });
  });

  it('uses one instance-wide schedule id, not one per org', () => {
    const options = buildLangfuseRetentionScheduleOptions();

    expect(options.scheduleId).toBe(LANGFUSE_RETENTION_SCHEDULE_ID);
    expect(options.scheduleId).not.toMatch(/org/);
  });

  it('starts the retention workflow on the shared task queue with no arguments', () => {
    const options = buildLangfuseRetentionScheduleOptions();

    expect(options.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'langfuseRetentionWorkflow',
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [],
    });
  });
});
