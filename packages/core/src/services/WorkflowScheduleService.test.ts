import { describe, expect, it } from 'vitest';
import { missionScheduleSpec } from './MissionScheduleService';
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

describe('missionScheduleSpec', () => {
  const spec = { orgId: 'org_northwind', missionSlug: 'crm-email-sweep', cron: '0 13,17,21 * * 1-5' };

  it('runs the mission-check job', () => {
    expect(missionScheduleSpec(spec)).toEqual({
      name: 'mission-schedule-org_northwind-crm-email-sweep',
      cron: '0 13,17,21 * * 1-5',
      job: 'mission.check',
      input: { orgId: 'org_northwind', missionSlug: 'crm-email-sweep' },
    });
  });

  it('does not collide with workflow schedules for the same slug', () => {
    const mission = missionScheduleSpec({ ...spec, missionSlug: 'shared-slug' });
    const workflow = workflowScheduleSpec({ orgId: 'org_northwind', workflowSlug: 'shared-slug', cron: '0 6 * * *' });

    expect(mission.name).not.toBe(workflow.name);
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
});
