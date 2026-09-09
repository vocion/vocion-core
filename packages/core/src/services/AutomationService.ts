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
import type { MirrorFreshness } from '@/services/CrmRecordsService';
import { and, desc, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import { cronIntervalMs, humanizeAge, previousFire } from '@/libs/cron/schedule';
import { db } from '@/libs/DB';
import {
  AUTOMATION_FIRE_WORKFLOW,
  automationScheduleIdFor,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';
import { automationRunSchema, automationSchema, knowledgeSourceSchema } from '@/models/Schema';
import { judgeMirrorFreshness } from '@/services/CrmRecordsService';

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
  return completeAutomationFire(await beginAutomationFire(orgId, slug, opts));
}

/** A fire whose run row exists and whose work has not been dispatched yet. */
export type PendingAutomationFire = {
  orgId: string;
  slug: string;
  kind: 'workflow' | 'mission_check' | 'job';
  automationRunId: number;
  doCfg: { workflow?: string; checkMission?: string; job?: string; prompt?: string; input?: Record<string, unknown> };
  input: Record<string, unknown>;
  invokedBy: string;
};

/**
 * Record the fire, before doing any of its work.
 *
 * Split from the dispatch so a caller can answer immediately with the run row
 * and let the work continue: `startMission` awaits the whole agent loop, so a
 * request that dispatched inline held an HTTP connection for the entire pass —
 * 2.7 minutes typically and 29 at the August peak.
 *
 * Every failure mode still writes a row: an inactive automation or a missing
 * mission throws before dispatch, which is why the row is inserted first.
 * @param orgId
 * @param slug
 * @param opts
 * @param opts.input - Overrides merged over the automation's authored `do.input`.
 * @param opts.invokedBy
 * @param opts.dryRun - Recorded on the run row so a rehearsal is never mistaken for a real fire.
 */
export async function beginAutomationFire(
  orgId: string,
  slug: string,
  opts: { input?: Record<string, unknown>; invokedBy?: string; dryRun?: boolean } = {},
): Promise<PendingAutomationFire> {
  const automation = await getAutomation(orgId, slug);
  if (!automation) {
    // Nothing to attribute a row to: the slug names no automation in this org.
    throw new Error(`automation "${slug}" not found for org ${orgId}`);
  }
  const invokedBy = opts.invokedBy ?? `automation:${slug}`;
  const doCfg = automation.doConfig;
  const input = { ...(doCfg.input ?? {}), ...(opts.input ?? {}) };
  const kind: 'workflow' | 'mission_check' | 'job' = doCfg.workflow ? 'workflow' : doCfg.job ? 'job' : 'mission_check';
  const row = { orgId, slug, kind, invokedBy, dryRun: opts.dryRun ?? false, input };

  if (automation.status !== 'active') {
    // Refused, but still recorded. A schedule firing a disabled automation
    // produced no run row, no mission run, and therefore no trace anywhere —
    // the fire simply did not appear to have happened.
    const message = `automation "${slug}" is not active`;
    await db.insert(automationRunSchema).values({ ...row, status: 'error', error: message, finishedAt: new Date() });
    throw new Error(message);
  }

  const [runRow] = await db
    .insert(automationRunSchema)
    .values({ ...row, status: 'running' })
    .returning({ id: automationRunSchema.id });
  return { orgId, slug, kind, automationRunId: runRow!.id, doCfg, input, invokedBy };
}

/**
 * Do the work and close out the row.
 *
 * A failure records the error and then rethrows — the caller's error handling
 * is unchanged from when this was one function.
 * @param pending - The recorded fire.
 */
export async function completeAutomationFire(
  pending: PendingAutomationFire,
): Promise<{ kind: 'workflow' | 'mission_check' | 'job'; runId: number; automationRunId: number; result?: unknown }> {
  const { orgId, slug, doCfg, input, invokedBy, automationRunId } = pending;
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
 * @param doCfg.prompt
 * @param input - Merged `do.input` + caller overrides. `input.prompt` replaces the authored orders for this fire.
 * @param invokedBy
 */
async function dispatchDo(
  orgId: string,
  slug: string,
  doCfg: { workflow?: string; checkMission?: string; job?: string; prompt?: string },
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
    // Built-in deterministic job — runs synchronously in the worker with full
    // DB access. Not an agent, not a workflow.
    const { runBuiltInJob } = await import('@/services/jobs/registry');
    const result = await runBuiltInJob(doCfg.job, orgId, input);
    return { kind: 'job', runId: 0, result };
  }

  const { getMission, scheduledCheckBrief, startMission } = await import('@/services/MissionService');
  const { queueSnapshot, summarizeMissionCheck } = await import('@/services/automations/checkSummary');
  const missionSlug = doCfg.checkMission!;
  const template = await getMission(orgId, missionSlug);
  if (!template) {
    throw new Error(`automation "${slug}": mission "${missionSlug}" not found`);
  }
  // `input.prompt` overrides the authored orders for THIS fire only. That is
  // what makes "does it identify anyone" a 30-second test ("PART ONE only,
  // report and stop") rather than a full pass that briefs and drafts.
  const prompt = typeof input.prompt === 'string' && input.prompt.trim() !== '' ? input.prompt : doCfg.prompt;
  const startedAt = new Date();
  const before = await queueSnapshot(orgId);
  const run = await startMission({
    orgId,
    missionSlug,
    // The automation's authored execution prompt rides the brief; the mission
    // charter + working notes stay attached as standing context.
    brief: scheduledCheckBrief(template, prompt),
    // Titled by the automation that fired it, not by the mission it checks:
    // `process-new-mqls` and `discovery-followup-check` both check the same
    // mission, so `Check: <mission name>` made them identical in Activity and
    // only `created_by` told them apart.
    title: `${slug}: ${template.name}`,
    mode: 'check',
    invokedBy,
  });
  // The summary the branch used to discard. Best-effort: a fire whose work
  // succeeded must not be recorded as failed because measuring it did.
  const result = await summarizeMissionCheck({ orgId, run, before, startedAt }).catch((err) => {
    // A fire whose work succeeded must not be recorded as failed because
    // MEASURING it did. Loud, though: a null result is the thing this change
    // exists to remove, so a silent fallback would quietly restore it.
    console.warn('[automation] could not summarize the mission check', { slug, missionRunId: run.id, error: (err as Error).message });
    return undefined;
  });
  return { kind: 'mission_check', runId: run.id, result };
}

export type AutomationRunRow = typeof automationRunSchema.$inferSelect;

export type AutomationRunFilter = {
  /** One automation. Omit for every fire in the org — the cross-automation log. */
  slug?: string;
  status?: 'running' | 'ok' | 'error';
  kind?: 'workflow' | 'mission_check' | 'job';
  /** `schedule` for automation-fired, `test-run` for the dashboard control. */
  invokedBy?: 'schedule' | 'test-run';
  /** Inclusive lower bound on `started_at`. */
  since?: Date;
  /** Exclusive upper bound on `started_at`. */
  until?: Date;
  limit?: number;
  /** `id` of the last row of the previous page. */
  cursor?: number;
};

/** A page of the run log, plus the cursor for the next one. */
export type AutomationRunPage = {
  runs: AutomationRunRow[];
  /** Total rows the filters matched, independent of the page. */
  total: number;
  /** Pass as `cursor` for the next page. Null when this is the last one. */
  nextCursor: number | null;
};

/**
 * Fires, newest first — one automation's or every automation's.
 *
 * Every fire wrote a row here all along; the only reader called this with
 * `limit 1` and a slug, so "has anything been running" was a question only
 * `psql` could answer. Nineteen hours of silence on 3 September were found a
 * week later, from a table the product never showed.
 *
 * `invoked_by` carries `automation:<slug>` for a schedule fire and
 * `dashboard:test-run` for the control, so the filter matches on the prefix
 * rather than asking the caller to know the encoding.
 * @param orgId - Tenant.
 * @param filter - Which fires, and how many.
 */
export async function listAutomationRuns(orgId: string, filter: AutomationRunFilter = {}): Promise<AutomationRunPage> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const where = and(
    eq(automationRunSchema.orgId, orgId),
    filter.slug ? eq(automationRunSchema.slug, filter.slug) : undefined,
    filter.status ? eq(automationRunSchema.status, filter.status) : undefined,
    filter.kind ? eq(automationRunSchema.kind, filter.kind) : undefined,
    filter.invokedBy === 'test-run' ? like(automationRunSchema.invokedBy, 'dashboard:%') : undefined,
    filter.invokedBy === 'schedule' ? like(automationRunSchema.invokedBy, 'automation:%') : undefined,
    filter.since ? gte(automationRunSchema.startedAt, filter.since) : undefined,
    filter.until ? lt(automationRunSchema.startedAt, filter.until) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(automationRunSchema)
      // The cursor rides `id`, not `started_at`: two fires inside the same
      // clock tick would otherwise page in an undefined order, and a page
      // boundary there would drop or repeat a row.
      .where(filter.cursor ? and(where, lt(automationRunSchema.id, filter.cursor)) : where)
      .orderBy(desc(automationRunSchema.id))
      .limit(limit + 1),
    db.select({ n: sql<number>`count(*)::int` }).from(automationRunSchema).where(where),
  ]);
  const page = rows.slice(0, limit);
  return {
    runs: page,
    total: Number(counted?.n ?? 0),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * One fire by id, scoped to the org. What an async test run polls.
 * @param orgId - Tenant.
 * @param id - `automation_run.id`.
 */
export function getAutomationRun(orgId: string, id: number) {
  return db.query.automationRunSchema.findFirst({
    where: and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.id, id)),
  });
}

/**
 * The last fire of each automation in one query — what every card needs.
 * @param orgId
 */
export async function lastRunBySlug(orgId: string): Promise<Map<string, AutomationRunRow>> {
  const rows = await db
    .select()
    .from(automationRunSchema)
    .where(eq(automationRunSchema.orgId, orgId))
    .orderBy(desc(automationRunSchema.id));
  const out = new Map<string, AutomationRunRow>();
  for (const row of rows) {
    if (!out.has(row.slug)) {
      out.set(row.slug, row);
    }
  }
  return out;
}

/**
 * Filter values actually present in the log, so the log's own filters are never a hardcoded list.
 * @param orgId
 */
export async function automationRunFacets(orgId: string): Promise<{ slugs: string[]; statuses: string[]; kinds: string[] }> {
  const rows = await db
    .selectDistinct({
      slug: automationRunSchema.slug,
      status: automationRunSchema.status,
      kind: automationRunSchema.kind,
    })
    .from(automationRunSchema)
    .where(eq(automationRunSchema.orgId, orgId));
  return {
    slugs: [...new Set(rows.map(r => r.slug))].sort(),
    statuses: [...new Set(rows.map(r => r.status))].sort(),
    kinds: [...new Set(rows.map(r => r.kind))].sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Schedule health — is the silence normal?                            */
/* ------------------------------------------------------------------ */

export type ScheduleHealth = {
  /** The cron this was judged against. Null for an event-when. */
  cron: string | null;
  /** When it should last have fired. Null when the cron is unparseable. */
  expectedAt: Date | null;
  /** When it actually last fired. Null when it never has. */
  lastFireAt: Date | null;
  /** How far behind, in ms. Null when there is no expectation to be behind. */
  behindMs: number | null;
  /** True when the schedule has missed its expected fire by more than one interval. */
  overdue: boolean;
  /** "expected hourly, last fire 19.3 hours ago". Null when healthy. */
  reason: string | null;
};

/**
 * Compare a schedule's last fire against the fire its cron expected.
 *
 * This is the one item that would have caught 3 September: three hourly
 * automations stopped at 05:00 UTC and resumed at 00:15 the next day, and the
 * card rendered one timestamp throughout. `paused` is honoured — a schedule a
 * person deliberately paused is quiet on purpose.
 * @param opts - The schedule, its last fire, and whether it is paused.
 * @param opts.cron - The `when.schedule` cron, or null/undefined for an event-when.
 * @param opts.lastFireAt - `started_at` of the most recent run.
 * @param opts.paused - Temporal reports the schedule paused.
 * @param opts.now - Evaluation time.
 */
export function scheduleHealth(opts: {
  cron?: string | null;
  lastFireAt?: Date | null;
  paused?: boolean;
  now?: Date;
}): ScheduleHealth {
  const now = opts.now ?? new Date();
  const cron = opts.cron ?? null;
  const lastFireAt = opts.lastFireAt ?? null;
  const base = { cron, expectedAt: null, lastFireAt, behindMs: null, overdue: false, reason: null };
  if (!cron || opts.paused) {
    return base;
  }
  const expectedAt = previousFire(cron, now);
  const intervalMs = cronIntervalMs(cron, now);
  if (!expectedAt || intervalMs === null) {
    return base;
  }
  const cadence = `every ${humanizeAge(intervalMs)}`;
  if (!lastFireAt) {
    return {
      cron,
      expectedAt,
      lastFireAt: null,
      behindMs: null,
      overdue: true,
      reason: `expected ${cadence}, and has never fired.`,
    };
  }
  const behindMs = now.getTime() - lastFireAt.getTime();
  // One whole interval of slack: a fire in flight, or a worker a minute late,
  // is not an outage. Missing two in a row is.
  const overdue = lastFireAt.getTime() < expectedAt.getTime() - intervalMs;
  return {
    cron,
    expectedAt,
    lastFireAt,
    behindMs,
    overdue,
    reason: overdue ? `expected ${cadence}, last fire ${humanizeAge(behindMs)} ago.` : null,
  };
}

/**
 * How fresh the connector mirrors an automation's work reads are, right now.
 *
 * The slugs come from the last fire's own tool calls (`result.mirror.sources`),
 * so this describes what the work actually reads rather than every source its
 * agent could reach. A fire over seven-day-old data is not a healthy fire
 * however green it looks.
 * @param orgId - Tenant.
 * @param slugs - Source slugs the fire read.
 */
export async function automationSourceFreshness(orgId: string, slugs: string[]): Promise<MirrorFreshness | null> {
  if (slugs.length === 0) {
    return null;
  }
  const rows = await db
    .select({
      slug: knowledgeSourceSchema.slug,
      lastSyncedAt: knowledgeSourceSchema.lastSyncedAt,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), inArray(knowledgeSourceSchema.slug, slugs)));
  if (rows.length === 0) {
    return null;
  }
  return judgeMirrorFreshness(rows.map(r => ({
    slug: r.slug,
    schedule: (r.configJson as { schedule?: string } | null)?.schedule ?? null,
    lastSyncedAt: r.lastSyncedAt,
  })));
}

/* ------------------------------------------------------------------ */
/* Abandoned-run reconciliation                                        */
/* ------------------------------------------------------------------ */

/**
 * How long a `running` row is given before it counts as abandoned. Above the
 * activity's `startToCloseTimeout`, so a pass still inside its own budget is
 * never closed out from under it.
 */
export const ABANDONED_RUN_AFTER_MS = 70 * 60_000;

/**
 * Close out fires that can no longer end.
 *
 * A `discovery-followup-check` row from 4 September sat `running` with no
 * `finished_at` because its worker restarted mid-flight, and nothing
 * reconciles those — so the card would have read "last run Sep 4" for ever. A
 * row that cannot end is worse than one that ended badly.
 * @param opts - Scope and clock.
 * @param opts.orgId - One tenant, or omit for every org (worker boot).
 * @param opts.now - Evaluation time.
 * @param opts.olderThanMs - Age at which a `running` row is abandoned.
 */
export async function reconcileAbandonedRuns(opts: {
  orgId?: string;
  now?: Date;
  olderThanMs?: number;
} = {}): Promise<{ reconciled: number; ids: number[] }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.olderThanMs ?? ABANDONED_RUN_AFTER_MS));
  const rows = await db
    .update(automationRunSchema)
    .set({
      status: 'error',
      error: 'abandoned: worker restart or activity timeout — the fire never reported an outcome',
      finishedAt: now,
    })
    .where(and(
      eq(automationRunSchema.status, 'running'),
      lt(automationRunSchema.startedAt, cutoff),
      opts.orgId ? eq(automationRunSchema.orgId, opts.orgId) : undefined,
    ))
    .returning({ id: automationRunSchema.id });
  return { reconciled: rows.length, ids: rows.map(r => r.id) };
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
    policies: {
      // Stated, not inherited. SKIP is also the server default, but a fire
      // that can claim leads must never run concurrently with itself, and a
      // safety property that important should not depend on a default we do
      // not control.
      overlap: 'SKIP',
      // An hourly pass that missed nineteen hours must not come back and fire
      // nineteen times at once. One catch-up fire covers the gap; the strip
      // and the run log are what show the gap happened.
      catchupWindow: '1 hour',
    },
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
