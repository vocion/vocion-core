import { describe, expect, it } from 'vitest';
import { workflowScheduleSpec } from './WorkflowScheduleService';

describe('workflowScheduleSpec', () => {
  const spec = { orgId: 'org_northwind', workflowSlug: 'weekly_report', cron: '0 12 * * 1-5' };

  it('runs the workflow-trigger job on the authored cron', () => {
    expect(workflowScheduleSpec(spec)).toEqual({
      name: 'workflow-schedule-org_northwind-weekly_report',
      cron: '0 12 * * 1-5',
      job: 'workflow.trigger',
      input: { orgId: 'org_northwind', workflowSlug: 'weekly_report', input: {} },
    });
  });

  it('passes fixed trigger input through to every scheduled run', () => {
    expect((workflowScheduleSpec({ ...spec, input: { mode: 'weekly' } }).input as { input: unknown }).input).toEqual({ mode: 'weekly' });
  });
});

describe('automationScheduleSpec', () => {
  it('runs the automation-fire job', async () => {
    const { automationScheduleSpec } = await import('./AutomationService');

    expect(automationScheduleSpec({ orgId: 'org_northwind', slug: 'morning-briefing', cron: '0 12 * * 1-5' })).toMatchObject({
      name: 'automation-org_northwind-morning-briefing',
      job: 'automation.fire',
      input: { orgId: 'org_northwind', slug: 'morning-briefing' },
    });
  });

  it('hands the zone to the engine, so a local-time schedule survives daylight saving (ADR 0008)', async () => {
    const { automationScheduleSpec } = await import('./AutomationService');

    expect(automationScheduleSpec({ orgId: 'org_northwind', slug: 'morning-briefing', cron: '30 6 * * 1-5', timezone: 'America/Los_Angeles' })).toMatchObject({ cron: '30 6 * * 1-5', timezone: 'America/Los_Angeles' });
    expect(automationScheduleSpec({ orgId: 'org_northwind', slug: 'morning-briefing', cron: '30 6 * * 1-5' })).not.toHaveProperty('timezone');
  });
});
