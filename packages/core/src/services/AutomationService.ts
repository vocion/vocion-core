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
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  AUTOMATION_FIRE_WORKFLOW,
  automationScheduleIdFor,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';
import { automationRunSchema, automationSchema } from '@/models/Schema';

export function listAutomations(orgId: string) {
  return db.select().from(automationSchema).where(eq(automationSchema.orgId, orgId));
}

/**
 * The agent that owns an automation. A `job`/`workflow` automation names its
 * owner directly (`ownerAgentSlug`); a `checkMission` automation inherits the
 * owner from the mission it checks. `null` when neither resolves.
 * @param auto - Automation row (its `ownerAgentSlug` + `doConfig`).
 * @param auto.ownerAgentSlug
 * @param auto.doConfig
 * @param auto.doConfig.checkMission
 * @param missionAgentBySlug - Map of mission slug → its owning agent slug.
 */
export function automationOwnerAgentSlug(
  auto: { ownerAgentSlug: string | null; doConfig: { checkMission?: string } },
  missionAgentBySlug: Map<string, string | null>,
): string | null {
  if (auto.ownerAgentSlug) {
    return auto.ownerAgentSlug;
  }
  if (auto.doConfig.checkMission) {
    return missionAgentBySlug.get(auto.doConfig.checkMission) ?? null;
  }
  return null;
}

export function getAutomation(orgId: string, slug: string) {
  return db.query.automationSchema.findFirst({
    where: and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, slug)),
  });
}

/**
 * Dispatch an automation's `do` — the single entry point for schedule fires
 * (via Temporal), event matches (via EventService), and on-demand runs from the
 * dashboard or CLI.
 *
 * Every dispatch writes an `automation_run` row before doing the work and
 * closes it out after, so a schedule fire leaves evidence whether it succeeded,
 * did nothing, or threw. A failure still records the error and then rethrows —
 * the caller's error handling is unchanged.
 * @param orgId
 * @param slug
 * @param opts
 * @param opts.input - Overrides merged over the automation's authored `do.input`.
 * @param opts.invokedBy
 * @param opts.dryRun - Recorded on the run row so a rehearsal is never mistaken for a real fire.
 */
export async function fireAutomation(
  orgId: string,
  slug: string,
  opts: { input?: Record<string, unknown>; invokedBy?: string; dryRun?: boolean } = {},
): Promise<{ kind: 'workflow' | 'mission_check' | 'job'; runId: number; automationRunId: number; result?: unknown }> {
  const automation = await getAutomation(orgId, slug);
  if (!automation) {
    throw new Error(`automation "${slug}" not found for org ${orgId}`);
  }
  if (automation.status !== 'active') {
    throw new Error(`automation "${slug}" is not active`);
  }
  const invokedBy = opts.invokedBy ?? `automation:${slug}`;
  const doCfg = automation.doConfig;
  const input = { ...(doCfg.input ?? {}), ...(opts.input ?? {}) };
  const kind: 'workflow' | 'mission_check' | 'job' = doCfg.workflow ? 'workflow' : doCfg.job ? 'job' : 'mission_check';

  const [runRow] = await db
    .insert(automationRunSchema)
    .values({ orgId, slug, kind, status: 'running', invokedBy, dryRun: opts.dryRun ?? false, input })
    .returning({ id: automationRunSchema.id });
  const automationRunId = runRow!.id;

  try {
    const dispatched = await dispatchDo(orgId, slug, doCfg, input, invokedBy);
    await db
      .update(automationRunSchema)
      .set({
        status: 'ok',
        result: (dispatched.result ?? null) as never,
        targetRunId: dispatched.runId || null,
        finishedAt: new Date(),
      })
      .where(eq(automationRunSchema.id, automationRunId));
    return { ...dispatched, automationRunId };
  } catch (err) {
    await db
      .update(automationRunSchema)
      .set({
        status: 'error',
        error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
        finishedAt: new Date(),
      })
      .where(eq(automationRunSchema.id, automationRunId));
    throw err;
  }
}

/**
 * The do-type switch. Split out so `fireAutomation` owns run bookkeeping only.
 * @param orgId
 * @param slug
 * @param doCfg
 * @param doCfg.workflow
 * @param doCfg.checkMission
 * @param doCfg.job
 * @param input
 * @param invokedBy
 */
async function dispatchDo(
  orgId: string,
  slug: string,
  doCfg: { workflow?: string; checkMission?: string; job?: string },
  input: Record<string, unknown>,
  invokedBy: string,
): Promise<{ kind: 'workflow' | 'mission_check' | 'job'; runId: number; result?: unknown }> {
  if (doCfg.workflow) {
    const { startWorkflow } = await import('@/services/WorkflowService');
    const run = await startWorkflow({
      orgId,
      slug: doCfg.workflow,
      input,
      triggerContext: { automation: slug, ...input },
      invokedBy,
    });
    return { kind: 'workflow', runId: run.id };
  }

  if (doCfg.job) {
    // Built-in deterministic job (e.g. discovery-sweep) — runs synchronously in
    // the worker with full DB access. Not an agent, not a workflow.
    const { runBuiltInJob } = await import('@/services/jobs/registry');
    const result = await runBuiltInJob(doCfg.job, orgId, input);
    return { kind: 'job', runId: 0, result };
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

/**
 * The most recent runs of an automation, newest first — what the Automation
 * page shows as "last run" so a silent schedule is visibly silent.
 * @param orgId
 * @param slug
 * @param limit
 */
export function listAutomationRuns(orgId: string, slug: string, limit = 5) {
  return db
    .select()
    .from(automationRunSchema)
    .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.slug, slug)))
    // id breaks ties: two fires inside the same clock tick would otherwise
    // come back in an undefined order.
    .orderBy(desc(automationRunSchema.startedAt), desc(automationRunSchema.id))
    .limit(limit);
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
