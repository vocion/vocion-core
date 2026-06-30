import { describe, expect, it } from 'vitest';
import { buildSourceScheduleOptions } from './SourceScheduleService';

describe('buildSourceScheduleOptions', () => {
  const spec = { orgId: 'org_daylyte', sourceId: 42, sourceSlug: 'google-ads', cron: '0 6 * * *' };

  it('builds a cron Schedule that starts the source-sync workflow incrementally', () => {
    const opts = buildSourceScheduleOptions(spec);

    expect(opts.scheduleId).toBe('source-sync-org_daylyte-google-ads');
    expect(opts.spec).toEqual({ cronExpressions: ['0 6 * * *'] });
    expect(opts.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'sourceSyncWorkflow',
      taskQueue: 'vocion-workflows',
    });
    expect((opts.action as { args: unknown[] }).args).toEqual([
      { orgId: 'org_daylyte', sourceId: 42, incremental: true },
    ]);
  });

  it('namespaces the schedule id per org + source (no collision)', () => {
    const a = buildSourceScheduleOptions({ ...spec, orgId: 'org_a' });
    const b = buildSourceScheduleOptions({ ...spec, orgId: 'org_b' });

    expect(a.scheduleId).not.toBe(b.scheduleId);
  });
});
