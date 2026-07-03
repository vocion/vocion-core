import { describe, expect, it } from 'vitest';
import { buildMissionScheduleOptions } from './MissionScheduleService';
import { buildWorkflowScheduleOptions } from './WorkflowScheduleService';

describe('buildWorkflowScheduleOptions', () => {
  const spec = { orgId: 'org_metacto', workflowSlug: 'weekly_report', cron: '0 12 * * 1-5' };

  it('builds a cron Schedule that starts the scheduled-workflow trigger', () => {
    const opts = buildWorkflowScheduleOptions(spec);

    expect(opts.scheduleId).toBe('workflow-schedule-org_metacto-weekly_report');
    expect(opts.spec).toEqual({ cronExpressions: ['0 12 * * 1-5'] });
    expect(opts.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'scheduledWorkflowTrigger',
      taskQueue: 'vocion-workflows',
    });
    expect((opts.action as { args: unknown[] }).args).toEqual([
      { orgId: 'org_metacto', workflowSlug: 'weekly_report', input: {} },
    ]);
  });

  it('passes fixed trigger input through to every scheduled run', () => {
    const opts = buildWorkflowScheduleOptions({ ...spec, input: { mode: 'weekly' } });

    expect((opts.action as { args: Array<{ input: unknown }> }).args[0]!.input).toEqual({ mode: 'weekly' });
  });
});

describe('buildMissionScheduleOptions', () => {
  const spec = { orgId: 'org_metacto', missionSlug: 'crm-email-sweep', cron: '0 13,17,21 * * 1-5' };

  it('builds a cron Schedule that starts the mission check', () => {
    const opts = buildMissionScheduleOptions(spec);

    expect(opts.scheduleId).toBe('mission-schedule-org_metacto-crm-email-sweep');
    expect(opts.spec).toEqual({ cronExpressions: ['0 13,17,21 * * 1-5'] });
    expect(opts.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'missionScheduledCheck',
      taskQueue: 'vocion-workflows',
    });
    expect((opts.action as { args: unknown[] }).args).toEqual([
      { orgId: 'org_metacto', missionSlug: 'crm-email-sweep' },
    ]);
  });

  it('does not collide with workflow schedules for the same slug', () => {
    const mission = buildMissionScheduleOptions({ ...spec, missionSlug: 'shared-slug' });
    const workflow = buildWorkflowScheduleOptions({ orgId: 'org_metacto', workflowSlug: 'shared-slug', cron: '0 6 * * *' });

    expect(mission.scheduleId).not.toBe(workflow.scheduleId);
  });
});

describe('buildAutomationScheduleOptions', () => {
  it('builds a cron Schedule that fires the automation dispatcher', async () => {
    const { buildAutomationScheduleOptions } = await import('./AutomationService');
    const opts = buildAutomationScheduleOptions({ orgId: 'org_metacto', slug: 'morning-briefing', cron: '0 12 * * 1-5' });

    expect(opts.scheduleId).toBe('automation-org_metacto-morning-briefing');
    expect(opts.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'automationFire',
      taskQueue: 'vocion-workflows',
    });
    expect((opts.action as { args: unknown[] }).args).toEqual([
      { orgId: 'org_metacto', slug: 'morning-briefing' },
    ]);
  });
});
