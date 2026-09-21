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
import type { AutomationCheckResult } from '@/services/automations/checkSummary';
import type { CausalChain, SkipReason } from '@/services/automations/fireGuards';
import type { MirrorFreshness } from '@/services/CrmRecordsService';
import type { AutomationRunCompletedPayload } from '@/services/EventService';
import { and, desc, eq, gte, inArray, like, lt, notInArray, sql } from 'drizzle-orm';
import { cronIntervalMs, humanizeAge, previousFire } from '@/libs/cron/schedule';
import { db } from '@/libs/DB';
import {
  AUTOMATION_FIRE_WORKFLOW,
  automationCoalescedWorkflowIdFor,
  automationScheduleIdFor,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';
import { automationRunSchema, automationSchema, knowledgeSourceSchema, userSchema } from '@/models/Schema';
import { extendChain, RATE_LIMIT_WINDOW_MS } from '@/services/automations/fireGuards';
import { judgeMirrorFreshness } from '@/services/CrmRecordsService';
import { assertWorkspaceRunning, WorkspacePausedError } from '@/services/workspacePause';

/**
 * The `automation_run.kind` of a pause or a resume. Not a fire: it dispatches
 * nothing and reads as a person's act in the same log the fires are in, so
 * "why did this go quiet on the 12th" is answered by the row above the gap.
 */
export const CONTROL_RUN_KIND = 'control';

/**
 * The `automation_run.kind` of a fire the event matcher refused: the event was
 * the automation's own run's residue, or the automation was over its ceiling
 * for the window. Not a fire either — nothing was dispatched — but written
 * down, because "why did the debrief not run on that" and "why did it run
 * sixty times" are both answered from this log or from nowhere.
 */
export const SKIPPED_RUN_KIND = 'skipped';

/** What a `skipped` run row carries in `result`. */
export type AutomationSkipResult = {
  kind: 'skipped';
  reason: SkipReason;
  /** The rule, in a sentence a person reads in the log. */
  detail: string;
  /** The event type that would have fired it. */
  event: string;
  /** The chain the event carried, so the loop it closed can be followed. */
  causedBy: CausalChain | null;
  /** On `rate_limited`: the ceiling in force. */
  ceiling?: number;
  /**
   * On `rate_limited`: what became of the held fire. `scheduled` — one
   * coalesced fire will run after the window; `pending` — one already was;
   * `unreachable` — Temporal was away, so nothing will replay this.
   */
  coalesce?: 'scheduled' | 'pending' | 'unreachable';
  /** On `rate_limited`: the `automation_run` of the coalesced fire that covered it, once it ran. */
  coalescedInto?: number | null;
};

/** Every kind that is a fire — not a person's control, not a refused match. */
const NON_FIRE_KINDS = [CONTROL_RUN_KIND, SKIPPED_RUN_KIND];

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
  opts: FireAutomationOptions = {},
): Promise<{ kind: 'workflow' | 'mission_check' | 'job'; runId: number; automationRunId: number; result?: unknown }> {
  return completeAutomationFire(await beginAutomationFire(orgId, slug, opts));
}

export type FireAutomationOptions = {
  /** Overrides merged over the automation's authored `do.input`. */
  input?: Record<string, unknown>;
  invokedBy?: string;
  /** Recorded on the run row so a rehearsal is never mistaken for a real fire. */
  dryRun?: boolean;
  /**
   * The fires that led to the event this fire answers, newest first. The
   * fire adds itself and hands the chain to the work it starts, so every
   * event that work raises can say which automations are already behind it.
   */
  causedBy?: CausalChain | null;
  /**
   * This is the one fire that stands in for the ones the ceiling held back.
   * The held `skipped` rows are claimed onto this run and their count rides
   * the result as `coalesced`.
   */
  coalesce?: boolean;
};

/** A fire whose run row exists and whose work has not been dispatched yet. */
export type PendingAutomationFire = {
  orgId: string;
  slug: string;
  kind: 'workflow' | 'mission_check' | 'job';
  automationRunId: number;
  doCfg: { workflow?: string; checkMission?: string; job?: string; prompt?: string; input?: Record<string, unknown> };
  input: Record<string, unknown>;
  /** What the CALLER handed in — an event's payload, or nothing for a schedule fire. */
  triggerInput?: Record<string, unknown>;
  invokedBy: string;
  /** The chain the work this fire starts will carry: this fire, then what fired it. */
  causedBy: CausalChain;
  /** How many held fires this one stands in for. Zero for an ordinary fire. */
  coalesced: number;
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
  opts: FireAutomationOptions = {},
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
  if (automation.pausedAt) {
    // The row is the record of a person's pause; Temporal's paused flag and
    // the event matcher's skip are how it is honoured on the way in. Should a
    // fire reach here anyway — a schedule Temporal never saw paused, a test
    // run, a CLI call — it is refused on the same evidence, and the refusal
    // is written down like the disabled one above.
    const message = `automation "${slug}" is paused${automation.pausedNote ? ` — ${automation.pausedNote}` : ''}`;
    await db.insert(automationRunSchema).values({ ...row, status: 'error', error: message, finishedAt: new Date() });
    throw new Error(message);
  }
  // The workspace's own off switch, which is a different fact from the
  // automation's. It is asked here — the one place every fire passes,
  // scheduled or event, test run or CLI call — and before any model call, so
  // a stopped workspace spends nothing. The refusal is a `skipped` row rather
  // than an `error`: nothing broke, a person said stop.
  try {
    await assertWorkspaceRunning(orgId, 'automation_fire');
  } catch (err) {
    if (err instanceof WorkspacePausedError) {
      await recordSkippedFire(orgId, slug, {
        event: opts.invokedBy ?? `automation:${slug}`,
        payload: input,
        invokedBy,
        result: { kind: 'skipped', reason: 'workspace_paused', detail: err.message, event: invokedBy, causedBy: opts.causedBy ?? null },
      });
    }
    throw err;
  }

  const [runRow] = await db
    .insert(automationRunSchema)
    .values({ ...row, status: 'running' })
    .returning({ id: automationRunSchema.id });
  const automationRunId = runRow!.id;
  // A coalesced fire stands in for the held ones: they are claimed onto this
  // run now, so a second coalesced fire never counts them again, and the
  // count is what the work is told it is covering.
  const coalesced = opts.coalesce ? await claimHeldFires(orgId, slug, automationRunId) : 0;
  const triggerInput = coalesced > 0
    ? { ...(opts.input ?? {}), coalesced, note: `${coalesced} fire${coalesced === 1 ? '' : 's'} in the last ten minutes were held by the rate ceiling; this one pass covers them.` }
    : opts.input;
  if (coalesced > 0) {
    await db.update(automationRunSchema).set({ input: { ...input, ...triggerInput } }).where(eq(automationRunSchema.id, automationRunId));
  }
  return {
    orgId,
    slug,
    kind,
    automationRunId,
    doCfg,
    input: { ...input, ...(triggerInput ?? {}) },
    triggerInput,
    invokedBy,
    causedBy: extendChain({ automationSlug: slug, automationRunId }, opts.causedBy),
    coalesced,
  };
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
  const { orgId, slug, doCfg, input, triggerInput, invokedBy, automationRunId, causedBy, coalesced } = pending;
  try {
    // The brief distinguishes an event fire from a schedule fire by what the
    // CALLER handed in, never by the merged input: a scheduled check with fixed
    // `do.input` is still a scheduled check.
    const dispatched = await dispatchDo(orgId, slug, doCfg, input, invokedBy, triggerInput, causedBy);
    // `coalesced: n` on the result is how the log says this one run stood in
    // for n held fires; a job's non-object result is wrapped rather than lost.
    const result = coalesced > 0
      ? { ...(dispatched.result && typeof dispatched.result === 'object' ? dispatched.result : { value: dispatched.result ?? null }), coalesced }
      : dispatched.result;
    await db
      .update(automationRunSchema)
      .set({
        status: 'ok',
        result: (result ?? null) as never,
        targetRunId: dispatched.runId || null,
        finishedAt: new Date(),
      })
      .where(eq(automationRunSchema.id, automationRunId));
    if (dispatched.kind === 'mission_check' && dispatched.result) {
      await announceCheckCompleted(orgId, slug, automationRunId, invokedBy, dispatched.result as AutomationCheckResult, causedBy);
    }
    return { ...dispatched, result, automationRunId };
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
 * Raise `automation_run.completed` for a mission check that produced a
 * result — the summary `summarizeMissionCheck` wrote. A workflow do leaves
 * no result and a job is deterministic code, so neither is a debrief's
 * business. Deduped on the automation run id.
 *
 * The loop this could form — an automation on `automation_run.completed`
 * whose own check completes and fires it again — is closed twice: a fire
 * that this event type started raises nothing, and the event carries the
 * chain of fires behind it, so the matcher skips every automation on it
 * (`services/automations/fireGuards.ts`).
 * @param orgId
 * @param slug - The automation.
 * @param automationRunId - Its run row.
 * @param invokedBy - Who started the fire; `event:automation_run.completed` means a debrief's own check.
 * @param result - The check summary.
 * @param causedBy - This fire and the ones behind it, as the mission run carries them.
 */
async function announceCheckCompleted(orgId: string, slug: string, automationRunId: number, invokedBy: string | undefined, result: AutomationCheckResult, causedBy: CausalChain): Promise<void> {
  const { AUTOMATION_RUN_COMPLETED, emitEvent } = await import('@/services/EventService');
  if (invokedBy?.startsWith(`event:${AUTOMATION_RUN_COMPLETED}`)) {
    return;
  }
  const payload: AutomationRunCompletedPayload = {
    automationRunId,
    slug,
    kind: 'mission_check',
    missionRunId: result.missionRunId,
    missionRunStatus: result.missionRunStatus,
    tasksOk: result.tasks.ok,
    tasksFailed: result.tasks.failed,
    summary: `${slug}: mission run ${result.missionRunId} ${result.missionRunStatus}, ${result.tasks.ok}/${result.tasks.total} tasks ok`,
    completedAt: new Date().toISOString(),
  };
  try {
    await emitEvent({
      orgId,
      type: AUTOMATION_RUN_COMPLETED,
      payload,
      dedupeKey: `${AUTOMATION_RUN_COMPLETED}:${automationRunId}`,
      invokedBy: `automation_run:${automationRunId}`,
      causedBy: causedBy.map((link, i) => (i === 0 ? { ...link, missionRunId: result.missionRunId } : link)),
    });
  } catch (error) {
    console.warn(`[automation] could not raise ${AUTOMATION_RUN_COMPLETED} for run ${automationRunId}`, error);
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
 * @param triggerInput - What the caller handed in: an event's payload, or nothing for a schedule fire.
 * @param causedBy - The chain the started work carries: this fire, then the fires behind the event that made it.
 */
async function dispatchDo(
  orgId: string,
  slug: string,
  doCfg: { workflow?: string; checkMission?: string; job?: string; prompt?: string },
  input: Record<string, unknown>,
  invokedBy: string,
  triggerInput: Record<string, unknown> | undefined,
  causedBy: CausalChain,
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
    // charter + working notes stay attached as standing context. An event
    // fire's payload rides it too, so the check knows what it was fired for;
    // a schedule fire hands in nothing and reads exactly as before.
    brief: scheduledCheckBrief(template, prompt, triggerInput && Object.keys(triggerInput).length > 0 ? triggerInput : undefined),
    // Titled by the automation that fired it, not by the mission it checks:
    // `process-new-mqls` and `discovery-followup-check` both check the same
    // mission, so `Check: <mission name>` made them identical in Activity and
    // only `created_by` told them apart.
    title: `${slug}: ${template.name}`,
    mode: 'check',
    invokedBy,
    // The run knows which fires are behind it, so `mission_run.completed`
    // can say so and never fire this automation again.
    causedBy,
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
  /** The three do-types, `control` — a person's pause or resume — or `skipped`, a match the guard refused; all kept in the same log. */
  kind?: 'workflow' | 'mission_check' | 'job' | 'control' | 'skipped';
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
 *
 * Ordered by when the fire STARTED, not by row id. A later-inserted row can be
 * an older fire, and ordering by id put a 4 September row still stuck
 * `running` on the card as "last run" while a fire from the 8th sat behind it.
 * @param orgId
 */
export async function lastRunBySlug(orgId: string): Promise<Map<string, AutomationRunRow>> {
  const rows = await db
    .select()
    .from(automationRunSchema)
    // A pause, a resume or a refused match is written to the same log but is
    // not a fire: it must not read as "last ran just now" on a card, nor
    // reset the overdue clock.
    .where(and(eq(automationRunSchema.orgId, orgId), notInArray(automationRunSchema.kind, NON_FIRE_KINDS)))
    .orderBy(desc(automationRunSchema.startedAt), desc(automationRunSchema.id));
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
/* Event-fire guards — the database half of fireGuards.ts              */
/* ------------------------------------------------------------------ */

/**
 * Write down a match the guard refused, so the log says why the automation
 * did not run on that event — one row per refusal, `kind: skipped`,
 * `status: ok` (nothing failed; the rule held).
 * @param orgId - Tenant.
 * @param slug - The automation that was not fired.
 * @param opts - The event, and the rule's verdict.
 * @param opts.event
 * @param opts.payload
 * @param opts.result
 * @param opts.invokedBy - Who asked, when it was not an event — a schedule fire refused by the workspace switch.
 */
export async function recordSkippedFire(
  orgId: string,
  slug: string,
  opts: { event: string; payload: Record<string, unknown>; result: AutomationSkipResult; invokedBy?: string },
): Promise<number> {
  const now = new Date();
  const [row] = await db.insert(automationRunSchema).values({
    orgId,
    slug,
    kind: SKIPPED_RUN_KIND,
    status: 'ok',
    invokedBy: opts.invokedBy ?? `event:${opts.event}`,
    dryRun: false,
    input: opts.payload,
    result: opts.result as never,
    startedAt: now,
    finishedAt: now,
  }).returning({ id: automationRunSchema.id });
  return row!.id;
}

/**
 * Event fires of one automation inside the rolling window — what the ceiling
 * is measured against. A schedule fire (`automation:<slug>`) and a test run
 * are not counted; nor are control rows or earlier refusals.
 * @param orgId - Tenant.
 * @param slug - The automation.
 * @param now - Evaluation time.
 */
export async function countRecentEventFires(orgId: string, slug: string, now: Date = new Date()): Promise<number> {
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(automationRunSchema)
    .where(and(
      eq(automationRunSchema.orgId, orgId),
      eq(automationRunSchema.slug, slug),
      notInArray(automationRunSchema.kind, NON_FIRE_KINDS),
      like(automationRunSchema.invokedBy, 'event:%'),
      gte(automationRunSchema.startedAt, new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)),
    ));
  return Number(counted?.n ?? 0);
}

/**
 * Arrange the one fire that stands in for the held ones: a Temporal
 * `automationFire` workflow with `coalesce: true`, started after the window.
 * Its id is per automation, so a second held fire while one is already
 * waiting finds it there and arranges nothing — that is the coalescing.
 * @param orgId - Tenant.
 * @param slug - The automation.
 */
export async function scheduleCoalescedFire(orgId: string, slug: string): Promise<'scheduled' | 'pending' | 'unreachable'> {
  try {
    const client = await getTemporalClient();
    await client.workflow.start(AUTOMATION_FIRE_WORKFLOW, {
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      workflowId: automationCoalescedWorkflowIdFor(orgId, slug),
      args: [{ orgId, slug, coalesce: true }],
      startDelay: RATE_LIMIT_WINDOW_MS,
    });
    return 'scheduled';
  } catch (err) {
    if (isAlreadyStarted(err)) {
      return 'pending';
    }
    // The refusal is on the record either way; what is lost is the replay,
    // and the row says so rather than promising one that will not come.
    console.warn(`[automation] could not arrange the coalesced fire for "${slug}"; the held fires will not be replayed`, { error: (err as Error).message });
    return 'unreachable';
  }
}

/**
 * Claim every held fire not yet covered onto this coalesced run, and say how
 * many there were. The claim is the `coalescedInto` on the skipped row, so a
 * person reading the refusal can follow it to the run that covered it.
 * @param orgId
 * @param slug
 * @param automationRunId - The coalesced fire's own row.
 */
async function claimHeldFires(orgId: string, slug: string, automationRunId: number): Promise<number> {
  const rows = await db
    .update(automationRunSchema)
    .set({ result: sql`${automationRunSchema.result} || jsonb_build_object('coalescedInto', ${automationRunId}::int)` })
    .where(and(
      eq(automationRunSchema.orgId, orgId),
      eq(automationRunSchema.slug, slug),
      eq(automationRunSchema.kind, SKIPPED_RUN_KIND),
      sql`${automationRunSchema.result}->>'reason' = 'rate_limited'`,
      sql`${automationRunSchema.result}->>'coalescedInto' IS NULL`,
    ))
    .returning({ id: automationRunSchema.id });
  return rows.length;
}

/** What the guard refused in the window, per automation — the card's warning. */
export type RecentSkips = { selfTrigger: number; rateLimited: number; ceiling: number | null };

/**
 * Refusals inside the rolling window, by slug, in one query. Absent for an
 * automation with none.
 * @param orgId - Tenant.
 * @param now - Evaluation time.
 */
export async function recentSkipsBySlug(orgId: string, now: Date = new Date()): Promise<Map<string, RecentSkips>> {
  const rows = await db
    .select({ slug: automationRunSchema.slug, result: automationRunSchema.result })
    .from(automationRunSchema)
    .where(and(
      eq(automationRunSchema.orgId, orgId),
      eq(automationRunSchema.kind, SKIPPED_RUN_KIND),
      gte(automationRunSchema.startedAt, new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)),
    ));
  const out = new Map<string, RecentSkips>();
  for (const row of rows) {
    const result = row.result as AutomationSkipResult | null;
    const entry = out.get(row.slug) ?? { selfTrigger: 0, rateLimited: 0, ceiling: null };
    if (result?.reason === 'rate_limited') {
      entry.rateLimited += 1;
      entry.ceiling = result.ceiling ?? entry.ceiling;
    } else {
      entry.selfTrigger += 1;
    }
    out.set(row.slug, entry);
  }
  return out;
}

function isAlreadyStarted(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'WorkflowExecutionAlreadyStartedError' || /already started|already exists/i.test(message);
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
/* Pause and resume — a person's hold, on the record                   */
/* ------------------------------------------------------------------ */

/** The person acting. `name` is what the log shows; `id` is what it is keyed on. */
export type AutomationActor = { id: string; name?: string | null };

/** What a `control` run row carries in `result`, so the log reads without a join. */
export type AutomationControlResult = {
  kind: 'control';
  action: 'pause' | 'resume';
  by: { id: string; name: string | null };
  note: string | null;
  /** How the Temporal Schedule took it. `null` for an event-when — there is none. */
  schedule: 'paused' | 'resumed' | 'unreachable' | null;
  /** On a resume: the pause it lifted. */
  lifted?: { by: string | null; at: string; note: string | null };
};

/** The paused state a surface shows: who, when, and the note they left. */
export type AutomationPause = { by: { id: string; name: string | null }; at: Date; note: string | null };

export class AutomationNotFoundError extends Error {
  constructor(slug: string) {
    super(`automation "${slug}" not found`);
    this.name = 'AutomationNotFoundError';
  }
}

/** Pause on a paused automation, or resume on a running one — the state already is what was asked for. */
export class AutomationPauseStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationPauseStateError';
  }
}

/**
 * Pause an automation, and say who and why.
 *
 * Three things, in this order: the row (the record — `beginAutomationFire`
 * and the event matcher both read it), the Temporal Schedule for a
 * schedule-when (so the fire never leaves Temporal), then a `control` run
 * row in the log. Temporal being unreachable does not undo the pause: the
 * row already refuses every fire, and the control row says `unreachable`
 * so the next apply — which re-asserts the pause — is known to be needed.
 * @param orgId - Tenant.
 * @param slug - Which automation.
 * @param opts - Who, and the optional note.
 * @param opts.by
 * @param opts.note
 * @param opts.now
 */
export async function pauseAutomation(
  orgId: string,
  slug: string,
  opts: { by: AutomationActor; note?: string | null; now?: Date },
): Promise<AutomationPause> {
  const automation = await getAutomation(orgId, slug);
  if (!automation) {
    throw new AutomationNotFoundError(slug);
  }
  if (automation.pausedAt) {
    throw new AutomationPauseStateError(`automation "${slug}" is already paused`);
  }
  const now = opts.now ?? new Date();
  const note = cleanNote(opts.note);
  await db
    .update(automationSchema)
    .set({ pausedAt: now, pausedBy: opts.by.id, pausedNote: note })
    .where(eq(automationSchema.id, automation.id));

  const schedule = automation.whenConfig.schedule
    ? await setScheduleState(orgId, slug, 'pause', controlNote(opts.by, note))
    : null;

  await recordControl(orgId, slug, now, {
    kind: 'control',
    action: 'pause',
    by: { id: opts.by.id, name: opts.by.name ?? null },
    note,
    schedule,
  });
  return { by: { id: opts.by.id, name: opts.by.name ?? null }, at: now, note };
}

/**
 * Resume a paused automation. Clears the hold, unpauses the Schedule for a
 * schedule-when, and records who lifted it and whose pause it was.
 * @param orgId - Tenant.
 * @param slug - Which automation.
 * @param opts - Who, and the optional note.
 * @param opts.by
 * @param opts.note
 * @param opts.now
 */
export async function resumeAutomation(
  orgId: string,
  slug: string,
  opts: { by: AutomationActor; note?: string | null; now?: Date },
): Promise<void> {
  const automation = await getAutomation(orgId, slug);
  if (!automation) {
    throw new AutomationNotFoundError(slug);
  }
  if (!automation.pausedAt) {
    throw new AutomationPauseStateError(`automation "${slug}" is not paused`);
  }
  const now = opts.now ?? new Date();
  const note = cleanNote(opts.note);
  await db
    .update(automationSchema)
    .set({ pausedAt: null, pausedBy: null, pausedNote: null })
    .where(eq(automationSchema.id, automation.id));

  const schedule = automation.whenConfig.schedule
    ? await setScheduleState(orgId, slug, 'unpause', controlNote(opts.by, note))
    : null;

  await recordControl(orgId, slug, now, {
    kind: 'control',
    action: 'resume',
    by: { id: opts.by.id, name: opts.by.name ?? null },
    note,
    schedule: schedule === 'paused' ? 'resumed' : schedule,
    lifted: { by: automation.pausedBy, at: automation.pausedAt.toISOString(), note: automation.pausedNote },
  });
}

/**
 * The pause on each automation row, with the person's name resolved — one
 * user lookup for the whole list. Rows that are not paused are absent.
 * @param rows - Automation rows, as `listAutomations` returns them.
 */
export async function pausesFor(
  rows: Array<{ slug: string; pausedAt: Date | null; pausedBy: string | null; pausedNote: string | null }>,
): Promise<Map<string, AutomationPause>> {
  const paused = rows.filter(r => r.pausedAt !== null);
  const names = await userNamesById(paused.map(r => r.pausedBy).filter((id): id is string => !!id));
  return new Map(paused.map(r => [r.slug, {
    by: { id: r.pausedBy ?? '', name: r.pausedBy ? names.get(r.pausedBy) ?? null : null },
    at: r.pausedAt!,
    note: r.pausedNote,
  }]));
}

/**
 * Display names for a set of users: the name they set, else their email.
 * Empty for an id that no longer resolves — the log's own copy of the name
 * (in the control row) is what covers that case.
 * @param ids - `user.id`s.
 */
export async function userNamesById(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: userSchema.id, name: userSchema.name, email: userSchema.email })
    .from(userSchema)
    .where(inArray(userSchema.id, unique));
  return new Map(rows.map(r => [r.id, r.name?.trim() || r.email]));
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, 500);
}

/**
 * The note Temporal keeps on the Schedule, readable in its own UI: who, and why.
 * @param by - The person acting.
 * @param note - Their note, if any.
 */
function controlNote(by: AutomationActor, note: string | null): string {
  return `${by.name ?? by.id}${note ? `: ${note}` : ''}`;
}

async function setScheduleState(
  orgId: string,
  slug: string,
  action: 'pause' | 'unpause',
  note: string,
): Promise<'paused' | 'unreachable'> {
  try {
    const client = await getTemporalClient();
    const handle = client.schedule.getHandle(automationScheduleIdFor(orgId, slug));
    if (action === 'pause') {
      await handle.pause(note);
    } else {
      await handle.unpause(note);
    }
    return 'paused';
  } catch (err) {
    // A schedule that does not exist yet (Temporal never saw an apply) has
    // nothing to pause; the row holds the pause and the next apply carries
    // it in. Anything else is Temporal being away, and is said so.
    console.warn(`[automation] could not ${action} the Temporal schedule for "${slug}"; the row holds the state`, { error: (err as Error).message });
    return 'unreachable';
  }
}

async function recordControl(orgId: string, slug: string, at: Date, result: AutomationControlResult): Promise<void> {
  await db.insert(automationRunSchema).values({
    orgId,
    slug,
    kind: CONTROL_RUN_KIND,
    status: 'ok',
    invokedBy: `user:${result.by.id}`,
    dryRun: false,
    input: { action: result.action, note: result.note },
    result: result as never,
    startedAt: at,
    finishedAt: at,
  });
}

/* ------------------------------------------------------------------ */
/* Temporal Schedule lifecycle (schedule-whens only)                   */
/* ------------------------------------------------------------------ */

export type AutomationScheduleSpec = {
  orgId: string;
  slug: string;
  cron: string;
  /**
   * A person's standing pause, from the automation row. When set, the
   * Schedule is created paused and an existing one is re-asserted paused —
   * a workspace apply never resumes what a person stopped. When absent the
   * Schedule's own state is left as it was, so apply never resumes anything.
   */
  paused?: { note: string | null };
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
    ...(spec.paused ? { state: { paused: true, note: spec.paused.note ?? undefined } } : {}),
  };
}

/**
 * Create (or update) the automation's Schedule. Idempotent.
 *
 * An update rewrites the spec and the action and touches the state only to
 * re-assert a person's pause. It never unpauses: the person who paused it is
 * the one who resumes it, from the app, on the record.
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
      await handle.update(prev => ({
        ...prev,
        spec: options.spec,
        action: options.action,
        state: options.state ? { ...prev.state, ...options.state } : prev.state,
      }));
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
