import { describe, expect, it } from 'vitest';
import { sourceReconcileScheduleSpec, sourceScheduleSpec } from './SourceScheduleService';

describe('sourceScheduleSpec', () => {
  const spec = { orgId: 'org_northwind', sourceId: 42, sourceSlug: 'google-ads', cron: '0 6 * * *' };

  it('runs the source-sync job incrementally on the manifest cron', () => {
    expect(sourceScheduleSpec(spec)).toEqual({
      name: 'source-sync-org_northwind-google-ads',
      cron: '0 6 * * *',
      job: 'source.sync',
      input: { orgId: 'org_northwind', sourceId: 42, incremental: true },
    });
  });

  it('namespaces the schedule per org + source (no collision)', () => {
    expect(sourceScheduleSpec({ ...spec, orgId: 'org_a' }).name).not.toBe(sourceScheduleSpec({ ...spec, orgId: 'org_b' }).name);
  });
});

describe('sourceReconcileScheduleSpec', () => {
  const spec = { orgId: 'org_northwind', sourceId: 42, sourceSlug: 'jira', cron: '0 3 * * *' };

  it('runs a FULL (non-incremental) sync', () => {
    const s = sourceReconcileScheduleSpec(spec);

    expect(s.name).toBe('source-reconcile-org_northwind-jira');
    expect(s.input).toEqual({ orgId: 'org_northwind', sourceId: 42, incremental: false });
  });

  it('never collides with the incremental schedule for the same source', () => {
    expect(sourceReconcileScheduleSpec(spec).name).not.toBe(sourceScheduleSpec(spec).name);
  });
});
