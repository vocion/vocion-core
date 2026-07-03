/**
 * AutomationService — automations are the WHEN of the system.
 *
 * An automation binds a trigger to a piece of work: `{when: schedule|event,
 * do: run workflow | check mission}`. Missions are pure goals and workflows
 * pure procedures — neither carries trigger logic.
 *
 * Schedule-whens materialize as Temporal Schedules (reconciled by
 * `workspace:apply`, same idempotent shape as source syncs); event-whens are
 * matched by EventService on emit. Both paths converge on `fireAutomation`.
 */

import type { ScheduleOptions } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  AUTOMATION_FIRE_WORKFLOW,
  automationScheduleIdFor,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';
import { automationSchema } from '@/models/Schema';

export function listAutomations(orgId: string) {
  return db.select().from(automationSchema).where(eq(automationSchema.orgId, orgId));
}

export function getAutomation(orgId: string, slug: string) {
  return db.query.automationSchema.findFirst({
    where: and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, slug)),
  });
}

/**
 * Dispatch an automation's `do` — the single entry point for schedule fires
 * (via Temporal) and event matches (via EventService).
 * @param orgId
 * @param slug
 * @param opts
 * @param opts.input
 * @param opts.invokedBy
 */
export async function fireAutomation(
  orgId: string,
  slug: string,
  opts: { input?: Record<string, unknown>; invokedBy?: string } = {},
): Promise<{ kind: 'workflow' | 'mission_check'; runId: number }> {
  const automation = await getAutomation(orgId, slug);
  if (!automation) {
    throw new Error(`automation "${slug}" not found for org ${orgId}`);
  }
  if (automation.status !== 'active') {
    throw new Error(`automation "${slug}" is not active`);
  }
  const invokedBy = opts.invokedBy ?? `automation:${slug}`;
  const doCfg = automation.doConfig;

  if (doCfg.workflow) {
    const { startWorkflow } = await import('@/services/WorkflowService');
    const run = await startWorkflow({
      orgId,
      slug: doCfg.workflow,
      input: { ...(doCfg.input ?? {}), ...(opts.input ?? {}) },
      triggerContext: { automation: slug, ...(opts.input ?? {}) },
      invokedBy,
    });
    return { kind: 'workflow', runId: run.id };
  }

  const { getMission, scheduledCheckBrief, startMission } = await import('@/services/MissionService');
  const missionSlug = doCfg.checkMission!;
  const template = await getMission(orgId, missionSlug);
  if (!template) {
    throw new Error(`automation "${slug}": mission "${missionSlug}" not found`);
  }
  const run = await startMission({
    orgId,
    missionSlug,
    brief: scheduledCheckBrief(template),
    title: `Check: ${template.name}`,
    mode: 'check',
    invokedBy,
  });
  return { kind: 'mission_check', runId: run.id };
}

/* ------------------------------------------------------------------ */
/* Temporal Schedule lifecycle (schedule-whens only)                   */
/* ------------------------------------------------------------------ */

export type AutomationScheduleSpec = {
  orgId: string;
  slug: string;
  cron: string;
};

/**
 * Build the Temporal `ScheduleOptions` for a schedule-when automation.
 * Pure — unit-testable.
 * @param spec
 */
export function buildAutomationScheduleOptions(spec: AutomationScheduleSpec): ScheduleOptions {
  return {
    scheduleId: automationScheduleIdFor(spec.orgId, spec.slug),
    spec: { cronExpressions: [spec.cron] },
    action: {
      type: 'startWorkflow',
      workflowType: AUTOMATION_FIRE_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [{ orgId: spec.orgId, slug: spec.slug }],
    },
  };
}

/**
 * Create (or update) the automation's Schedule. Idempotent.
 * @param spec
 */
export async function ensureAutomationSchedule(spec: AutomationScheduleSpec): Promise<void> {
  const client = await getTemporalClient();
  const options = buildAutomationScheduleOptions(spec);
  try {
    await client.schedule.create(options);
  } catch (err) {
    if (isAlreadyExists(err)) {
      const handle = client.schedule.getHandle(options.scheduleId);
      await handle.update(prev => ({ ...prev, spec: options.spec, action: options.action }));
      return;
    }
    throw err;
  }
}

/**
 * Delete the automation's Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param slug
 */
export async function removeAutomationSchedule(orgId: string, slug: string): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(automationScheduleIdFor(orgId, slug)).delete();
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

/**
 * Describe the automation's schedule (next fire times) — best-effort, for
 * the Automation page. Null when the schedule (or Temporal) is absent.
 * @param orgId
 * @param slug
 */
export async function describeAutomationSchedule(
  orgId: string,
  slug: string,
): Promise<{ nextActionTimes: Date[]; paused: boolean } | null> {
  try {
    const client = await getTemporalClient();
    const desc = await client.schedule.getHandle(automationScheduleIdFor(orgId, slug)).describe();
    return {
      nextActionTimes: (desc.info.nextActionTimes ?? []).slice(0, 3),
      paused: desc.state.paused ?? false,
    };
  } catch {
    return null;
  }
}

function isAlreadyExists(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ScheduleAlreadyRunning' || /already exists|already running/i.test(message);
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ScheduleNotFoundError' || /not found/i.test(message);
}
