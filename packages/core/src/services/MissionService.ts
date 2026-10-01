/**
 * MissionService — the open-ended, team work mode.
 *
 * A Mission is a goal-driven assignment a team of agents plans and works under
 * human review. It reuses the agent runtime (runAgentDeep), the autonomy ladder,
 * and the workspace_sha audit stamp. Workflows are what successful missions get
 * promoted* into (promoteMissionToWorkflow drafts one).
 */

import type { CausalChain } from '@/services/automations/fireGuards';
import { and, desc, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { AUTOMATION_FIRE_WORKFLOW, automationRefireWorkflowIdFor, getTemporalClient, VOCION_WORKFLOWS_TASK_QUEUE } from '@/libs/temporal/client';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { automationRunSchema, missionRunSchema, missionSchema, toolCallSchema, workflowSchema } from '@/models/Schema';
import { clampAutonomyLevel } from './missions/autonomy';
import { planMission } from './missions/planner';
import { leadlessTeamsNote, resolveMissionRoster } from './missions/roster';
import { executeMissionRun } from './missions/runtime';
import { SETTLED_RUN_STATUSES } from './settledRunStatus';
import { assertWorkspaceRunning } from './workspacePause';

export type MissionRunSummary = typeof missionRunSchema.$inferSelect;

export function listMissions(orgId: string) {
  return db.select().from(missionSchema).where(eq(missionSchema.orgId, orgId));
}

export function getMission(orgId: string, slug: string) {
  return db.query.missionSchema.findFirst({
    where: and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, slug)),
  });
}

export function getMissionRun(runId: number, orgId: string) {
  return db.query.missionRunSchema.findFirst({
    where: and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId)),
  });
}

/**
 * List mission runs for an org, newest first. `missionId` narrows to one
 * mission's runs — used by the `/api/v1/missions/:slug/runs` read route so
 * a caller only sees the runs of the mission it asked about, not every run
 * in the org.
 * `id` breaks ties, which `createdAt` has whenever two runs are written in
 * the same instant.
 * @param orgId
 * @param opts
 * @param opts.status
 * @param opts.limit
 * @param opts.missionId
 */
export function listMissionRuns(orgId: string, opts: { status?: string; limit?: number; missionId?: number } = {}) {
  const conditions = [eq(missionRunSchema.orgId, orgId)];
  if (opts.status) {
    conditions.push(eq(missionRunSchema.status, opts.status));
  }
  if (opts.missionId !== undefined) {
    conditions.push(eq(missionRunSchema.missionId, opts.missionId));
  }
  return db.select().from(missionRunSchema).where(and(...conditions)).orderBy(desc(missionRunSchema.createdAt), desc(missionRunSchema.id)).limit(opts.limit ?? 50);
}

/** One row of the operator's run list — enough to find a runaway, not the plan. */
export type MissionRunListItem = {
  id: number;
  missionId: number | null;
  missionSlug: string | null;
  title: string;
  status: string;
  createdBy: string | null;
  causedBy: CausalChain | null;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
};

/** The most rows one page of the run list returns. */
export const MISSION_RUN_LIST_MAX = 200;

/**
 * The run list an operator hunts a runaway with: filter by `status` and by
 * the mission's slug, newest first, with the total the filters matched so
 * "how many are still running" is one call and not a page count.
 *
 * `mission_list_runs` over MCP answered fifty rows and no total, so on 20
 * September the sixty `wiki-debrief` runs had to be counted in `psql`.
 * @param orgId - Tenant.
 * @param opts - Filters and the page size (clamped to {@link MISSION_RUN_LIST_MAX}).
 * @param opts.status
 * @param opts.missionSlug
 * @param opts.limit
 */
export async function listMissionRunsPage(
  orgId: string,
  opts: { status?: string; missionSlug?: string; limit?: number } = {},
): Promise<{ runs: MissionRunListItem[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), MISSION_RUN_LIST_MAX);
  const where = and(
    eq(missionRunSchema.orgId, orgId),
    opts.status ? eq(missionRunSchema.status, opts.status) : undefined,
    opts.missionSlug ? eq(missionSchema.slug, opts.missionSlug) : undefined,
  );
  const base = db
    .select({
      id: missionRunSchema.id,
      missionId: missionRunSchema.missionId,
      missionSlug: missionSchema.slug,
      title: missionRunSchema.title,
      status: missionRunSchema.status,
      createdBy: missionRunSchema.createdBy,
      causedBy: missionRunSchema.causedBy,
      createdAt: missionRunSchema.createdAt,
      completedAt: missionRunSchema.completedAt,
      error: missionRunSchema.error,
    })
    .from(missionRunSchema)
    .leftJoin(missionSchema, eq(missionRunSchema.missionId, missionSchema.id))
    .where(where);
  const [rows, [counted]] = await Promise.all([
    base.orderBy(desc(missionRunSchema.createdAt), desc(missionRunSchema.id)).limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(missionRunSchema)
      .leftJoin(missionSchema, eq(missionRunSchema.missionId, missionSchema.id))
      .where(where),
  ]);
  return { runs: rows.map(r => ({ ...r, causedBy: r.causedBy ?? null })), total: Number(counted?.n ?? 0) };
}

/**
 * One task's outcome inside a mission run's plan, as an outside caller
 * reads it: the agent's status for that step, the failure reason when it
 * has one, and `output` — the agent's own free-text report of what it did
 * or, on 2026-09-08's incident, why it proposed nothing at all.
 */
export type MissionRunTaskReport = {
  id: string;
  title: string;
  status: string;
  output?: string;
  error?: string;
};

/**
 * The shape returned by `/api/v1/missions/:slug/runs` and
 * `/api/v1/mission-runs/:id`. Bridges the `mission_run` row (models/Schema.ts)
 * to field names an outside caller — the Larkfield source registry, for one —
 * can read without knowing our column names: `startedAt`/`finishedAt`
 * instead of `createdAt`/`completedAt`, `invokedBy` instead of `createdBy`,
 * and `missionSlug` resolved from the joined mission template (null for an
 * ad-hoc run that never had one).
 *
 * A run's own `status`/`error` can read "completed"/null even when a task
 * inside it failed — the run engine records that failure on the task, not
 * the run — so a caller after real success/failure detail reads
 * `plan.tasks[].status`/`.error`, not just these top-level fields.
 */
export type MissionRunReport = {
  id: number;
  missionSlug: string | null;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  invokedBy: string | null;
  plan: { tasks: MissionRunTaskReport[] };
};

/**
 * Normalize a run's `plan` column into the shape `MissionRunReport.plan`
 * promises. The column has no DB-level NOT NULL (only a default), so it can
 * be a literal `null`; a row written before `tasks` existed, or edited by
 * hand, can also carry a `plan` object with no `tasks` array, or a `tasks`
 * that isn't an array at all. Any of those would otherwise reach the API
 * response as `plan.tasks === undefined`, and a caller iterating
 * `plan.tasks[]` — the whole point of this route — would throw. Falling
 * back to an empty array is the same "nothing to report yet" a caller
 * already has to handle for a run with a real, empty plan.
 * @param plan - The run's raw `plan` column value.
 */
function normalizePlanTasks(plan: MissionRunSummary['plan']): { tasks: MissionRunTaskReport[] } {
  if (!plan || !Array.isArray(plan.tasks)) {
    return { tasks: [] };
  }
  return { tasks: plan.tasks };
}

function toMissionRunReport(run: MissionRunSummary, missionSlug: string | null): MissionRunReport {
  return {
    id: run.id,
    missionSlug,
    status: run.status,
    startedAt: run.createdAt,
    finishedAt: run.completedAt,
    error: run.error,
    invokedBy: run.createdBy,
    plan: normalizePlanTasks(run.plan),
  };
}

/**
 * Resolve one mission run's slug by looking up its mission template. Missions
 * can start ad-hoc with no template (see `missionRunSchema.missionId`), so
 * `missionId === null` resolves to a null slug rather than a lookup.
 *
 * Takes `orgId` and filters on it even though the run this id came from was
 * already confirmed to belong to that org — belt and suspenders against a
 * `mission_run.mission_id` that ever pointed at another org's mission (a data
 * bug elsewhere, not a reachable path today) leaking that mission's slug.
 * @param missionId
 * @param orgId
 */
async function missionSlugFor(missionId: number | null, orgId: string): Promise<string | null> {
  if (missionId === null) {
    return null;
  }
  const mission = await db.query.missionSchema.findFirst({
    where: and(eq(missionSchema.id, missionId), eq(missionSchema.orgId, orgId)),
    columns: { slug: true },
  });
  return mission?.slug ?? null;
}

/**
 * Fetch one mission run's full report for `/api/v1/mission-runs/:id`. Null
 * when no run with that id exists in this org — the route turns that into a
 * 404, the same way a wrong-org token is refused for every other resource
 * under `/api/v1`.
 * @param runId
 * @param orgId
 */
export async function getMissionRunReport(runId: number, orgId: string): Promise<MissionRunReport | null> {
  const run = await getMissionRun(runId, orgId);
  if (!run) {
    return null;
  }
  const missionSlug = await missionSlugFor(run.missionId, orgId);
  return toMissionRunReport(run, missionSlug);
}

/**
 * List the most recent runs of one mission template, for
 * `/api/v1/missions/:slug/runs`. Null when the slug does not resolve to a
 * mission in this org — the route turns that into a 404 rather than an
 * empty list, so a wrong-tenant token cannot tell "no mission" from "no
 * runs yet" and use it to probe for slugs that exist in other orgs.
 * @param orgId
 * @param missionSlug
 * @param limit
 */
export async function listMissionRunReportsForMission(
  orgId: string,
  missionSlug: string,
  limit: number,
): Promise<MissionRunReport[] | null> {
  const mission = await getMission(orgId, missionSlug);
  if (!mission) {
    return null;
  }
  const runs = await listMissionRuns(orgId, { missionId: mission.id, limit });
  return runs.map(run => toMissionRunReport(run, missionSlug));
}

/**
 * Start a mission from a brief — either from an authored template (missionSlug)
 * or ad-hoc (team supplied). Plans the work, then runs to completion or to the
 * first approval gate, and returns the run.
 * @param opts
 * @param opts.orgId
 * @param opts.brief
 * @param opts.title
 * @param opts.missionSlug
 * @param opts.team
 * @param opts.team.lead
 * @param opts.team.members
 * @param opts.autonomyLevel
 * @param opts.invokedBy
 * @param opts.mode
 * @param opts.causedBy
 */
export async function startMission(opts: {
  orgId: string;
  brief: string;
  title?: string;
  missionSlug?: string;
  team?: { lead: string; members: string[] };
  autonomyLevel?: number;
  invokedBy?: string;
  /**
   * `planned` (default) — the lead decomposes the brief into a task graph.
   * `check` — a standing-responsibility check (fired by the mission's
   * schedule): ONE lead-agent task, no planner. The lead reviews the charter
   * against current state, does only what's needed now (workflows, skills,
   * tools, open-ended work), and reports. Cheap enough to run hourly.
   */
  mode?: 'planned' | 'check';
  /**
   * The automation fires behind this run, newest first — set by a check
   * fire, absent for a brief a person gave. Stamped on the row and carried
   * on `mission_run.completed`, so the automation that started the run is
   * never fired again by its completion.
   */
  causedBy?: CausalChain | null;
}): Promise<MissionRunSummary> {
  // The workspace off switch, before the planner and before any model call:
  // a mission run IS the factory working, whoever asked for it — the API, MCP
  // `mission_start`, an automation's check, or a chat turn that reached for
  // one. The refusal carries the pause note, so the person asking reads why.
  await assertWorkspaceRunning(opts.orgId, 'mission_run');
  let team = opts.team;
  let goal: string | undefined;
  let missionId: number | undefined;
  let autonomyLevel = opts.autonomyLevel;
  let charter: { successCriteria: string[]; name?: string } | undefined;
  let rosterNote: string | null = null;

  if (opts.missionSlug) {
    const template = await getMission(opts.orgId, opts.missionSlug);
    if (!template) {
      throw new Error(`mission template "${opts.missionSlug}" not found`);
    }
    missionId = template.id;
    // Missions own one agent (template.agentSlug). Member resolution is
    // roster.ts (F1): the workspace lead consults the TEAM LEADS from the
    // team table; any other lead keeps the parent_agent_slug reverse-lookup
    // (see 0041); a specialist works alone. Lead-less teams come back by
    // name and ride the brief as a "no lead yet" note (acceptance #5).
    if (!team) {
      const roster = await resolveMissionRoster(opts.orgId, template.agentSlug);
      team = roster.team;
      rosterNote = leadlessTeamsNote(roster.leadlessTeams);
    }
    goal = template.goal;
    autonomyLevel = autonomyLevel ?? (template.autonomyPolicy as { level?: number } | null)?.level;
    charter = { successCriteria: template.successCriteria ?? [], name: template.name };
  }
  if (!team?.lead) {
    throw new Error('a mission needs an agent (or a template slug)');
  }
  const level = clampAutonomyLevel(autonomyLevel);
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);
  // The note travels ON the brief: the planner prompt and every task
  // message — including the lead's synthesis — embed the brief verbatim
  // (planner.ts planningPrompt, missions/runtime.ts taskMessage), so the
  // final answer can name each lead-less team instead of dropping it.
  const brief = rosterNote ? `${opts.brief}\n\n${rosterNote}` : opts.brief;

  const [run] = await db.insert(missionRunSchema).values({
    orgId: opts.orgId,
    missionId,
    title: opts.title ?? opts.brief.slice(0, 80),
    brief,
    goal,
    status: 'planning',
    team,
    autonomyPolicy: { level },
    plan: { tasks: [] },
    workspaceSha,
    createdBy: opts.invokedBy,
    causedBy: opts.causedBy && opts.causedBy.length > 0 ? opts.causedBy : null,
  }).returning();

  // Check mode: one lead task, no planner. Planned mode: decompose first.
  // (Both execute in-process for now; Temporal-durable sessions are Phase 2.)
  const tasks = opts.mode === 'check'
    ? [{
        id: 'scheduled-check',
        title: charter?.name ? `Scheduled check: ${charter.name}` : 'Scheduled check',
        ownerAgentSlug: team.lead,
        type: 'analysis' as const,
        status: 'pending' as const,
        dependsOn: [],
      }]
    : await planMission({ orgId: opts.orgId, brief, goal, team, userId: opts.invokedBy });
  // Only a run still at `planning` moves on. One a person cancelled while
  // the planner was thinking stays cancelled, and none of its tasks start
  // (vocion-core#123).
  const moved = await db
    .update(missionRunSchema)
    .set({ plan: { tasks }, status: 'running' })
    .where(and(eq(missionRunSchema.id, run!.id), eq(missionRunSchema.status, 'planning')))
    .returning({ id: missionRunSchema.id });
  if (moved.length === 0) {
    return (await getMissionRun(run!.id, opts.orgId))!;
  }
  await executeMissionRun(run!.id, opts.orgId);

  return (await getMissionRun(run!.id, opts.orgId))!;
}

/**
 * The standing brief a scheduled check carries — built from the mission
 * charter so the lead knows this is a periodic check, not a fresh project.
 *
 * `executionPrompt` (authored on the automation as `do.prompt`) replaces the
 * generic "review current state, do what's needed" instruction with the
 * automation's marching orders for this cadence. The mission stays attached
 * as standing context either way: charter, responsibilities, working notes,
 * and the notes-update contract all still travel on the brief.
 * @param template
 * @param template.name
 * @param template.goal
 * @param template.successCriteria
 * @param template.workingNotes
 * @param executionPrompt
 * @param triggerPayload
 */
export function scheduledCheckBrief(
  template: { name: string; goal: string; successCriteria?: string[] | null; workingNotes?: string | null },
  executionPrompt?: string,
  triggerPayload?: Record<string, unknown>,
): string {
  const payloadKeys = triggerPayload ? Object.keys(triggerPayload) : [];
  return [
    payloadKeys.length > 0
      ? `Event-triggered check of your standing mission "${template.name}".`
      : `Scheduled check of your standing mission "${template.name}".`,
    `Charter: ${template.goal}`,
    template.successCriteria?.length
      ? `Responsibilities:\n${template.successCriteria.map(c => `- ${c}`).join('\n')}`
      : '',
    template.workingNotes
      ? `WORKING NOTES from your previous checks (your memory — trust it):\n${template.workingNotes}`
      : 'WORKING NOTES: none yet — this is your first tracked check.',
    // An event-when automation's payload is the whole reason this check is
    // running (which lead replied, which meeting booked). It rides the brief
    // verbatim so the orders can refer to it by key; a schedule fire has none.
    payloadKeys.length > 0
      ? `TRIGGER PAYLOAD, the event that started this check (JSON):\n${JSON.stringify(triggerPayload, null, 2)}`
      : '',
    executionPrompt
      ? `YOUR ORDERS FOR THIS CHECK:\n${executionPrompt}`
      : `This is a periodic check, not a fresh project. Review the current state against your working notes, do ONLY what is needed right now (use your skills, propose actions for anything touching external systems), and finish with a short report. If nothing needs doing, say so in one paragraph and stop.`,
    `BEFORE you finish: call update_mission_notes with your REWRITTEN working notes — carry forward every still-open thread (and say how many consecutive checks it has been open, escalating language as it ages), every commitment with its due date, and DROP anything resolved. Keep it under ~40 lines.`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Thrown when a resume can't claim the run — another resume got there
 * first, or the run isn't sitting at an approval gate at all. This means
 * "nothing to do here", not "the server broke".
 */
export class MissionRunNotResumableError extends Error {
  constructor(runId: number) {
    super(`mission run ${runId} is no longer resumable — it may already have been resumed, or it isn't currently paused for review`);
    this.name = 'MissionRunNotResumableError';
  }
}

/**
 * Approve the gated task and continue execution.
 *
 * Two tabs, or a click racing an MCP `mission_approve`, can both call this
 * for the same run. The read below only shapes the new plan — the claim is
 * the UPDATE's WHERE clause, so the loser gets zero rows and never reaches
 * `executeMissionRun`. The gated task runs once.
 * @param runId
 * @param orgId
 */
export async function resumeMission(runId: number, orgId: string): Promise<MissionRunSummary> {
  const run = await getMissionRun(runId, orgId);
  if (!run) {
    throw new Error(`mission run ${runId} not found`);
  }
  const tasks = run.plan?.tasks ?? [];
  for (const t of tasks) {
    if (t.status === 'awaiting_approval') {
      t.status = 'pending';
      t.approvalRequired = false; // approved by the human
      // An external task at autonomy 1–2 is gated by its type, not by the
      // flag, so clearing the flag alone sent it straight back for approval
      // on every resume. The loop's gate skips a task a person approved.
      t.approvedAt = new Date().toISOString();
    }
  }
  const claimed = await db
    .update(missionRunSchema)
    // Flipping `status` in the same statement as the WHERE that checks it
    // is what makes the claim stick. Leave it alone and the row still looks
    // claimable after the winner's write, so the loser matches too.
    .set({ status: 'running', plan: { tasks }, pauseReason: null, pausedAt: null })
    .where(and(
      eq(missionRunSchema.id, runId),
      eq(missionRunSchema.orgId, orgId),
      eq(missionRunSchema.status, 'awaiting_review'),
    ))
    .returning({ id: missionRunSchema.id });

  if (claimed.length === 0) {
    throw new MissionRunNotResumableError(runId);
  }

  await executeMissionRun(runId, orgId);
  return (await getMissionRun(runId, orgId))!;
}

/**
 * Cancel a run that is still going. The loop reads the cancel on its next
 * write and starts no further task (`missions/runtime.ts`).
 *
 * A run that already ended is left exactly as it is: cancelling a completed
 * or failed run used to relabel it `cancelled` and overwrite its error, which
 * erased what really happened to it.
 * @param runId - The run to cancel.
 * @param orgId - The caller's org; a run in another org is never touched.
 * @param reason - Shown on the run as its error.
 * @returns The run as it stands after the call.
 */
export async function cancelMission(runId: number, orgId: string, reason?: string): Promise<MissionRunSummary> {
  await db.update(missionRunSchema)
    .set({ status: 'cancelled', error: reason ?? 'cancelled by user', completedAt: new Date() })
    .where(and(
      eq(missionRunSchema.id, runId),
      eq(missionRunSchema.orgId, orgId),
      notInArray(missionRunSchema.status, [...SETTLED_RUN_STATUSES]),
    ));
  return (await getMissionRun(runId, orgId))!;
}

export async function submitMissionRunFeedback(opts: {
  orgId: string;
  runId: number;
  rating: 'up' | 'down';
  note?: string;
  by?: string;
}): Promise<void> {
  await db.update(missionRunSchema)
    .set({ rating: opts.rating, feedbackNote: opts.note, feedbackBy: opts.by, feedbackAt: new Date() })
    .where(and(eq(missionRunSchema.id, opts.runId), eq(missionRunSchema.orgId, opts.orgId)));
  if (opts.by) {
    const { queueRunFeedbackForLearning } = await import('@/services/feedback/runFeedbackQueue');
    void queueRunFeedbackForLearning({
      orgId: opts.orgId,
      kind: 'mission',
      runId: opts.runId,
      rating: opts.rating,
      note: opts.note ?? null,
      submittedBy: opts.by,
    });
    const { trackReviewFeedback } = await import('@/services/adoption/attribution');
    void trackReviewFeedback(
      { orgId: opts.orgId, userId: opts.by },
      { kind: 'mission', id: opts.runId },
      { rating: opts.rating, hasNote: !!opts.note },
    );
  }
}

/**
 * Promote a completed mission into a draft Workflow (Phase 6 will auto-detect
 * repeatable patterns; this MVP stub drafts one from the task graph for review).
 * @param runId
 * @param orgId
 */
export async function promoteMissionToWorkflow(runId: number, orgId: string): Promise<{ slug: string }> {
  const run = await getMissionRun(runId, orgId);
  if (!run) {
    throw new Error(`mission run ${runId} not found`);
  }
  const tasks = run.plan?.tasks ?? [];
  const slug = `from-mission-${runId}`;
  const steps = tasks.map(t => ({
    name: t.id,
    type: t.approvalRequired ? 'approve' : 'skill',
    title: t.title,
    agent: t.ownerAgentSlug,
    note: 'Drafted from a mission — wire to a real operation before activating.',
  }));
  await db.insert(workflowSchema).values({
    orgId,
    slug,
    name: `${run.title} (from mission)`,
    description: `Draft workflow promoted from mission run #${runId}. Review and refine before activating.`,
    status: 'draft',
    trigger: { type: 'manual' },
    steps,
  }).onConflictDoNothing();
  return { slug };
}

/**
 * Rewrite one mission's working notes, handing back the text that was there.
 *
 * The notes are the mission's own memory across scheduled checks, and a
 * rewrite used to be a bare column write from the agent's tool: no receipt,
 * no history, no way back. Returning `previous` is what lets
 * `mission.update_notes` declare an `undo` and therefore run on its own —
 * the restore is exact, not a regeneration.
 * @param orgId - The project.
 * @param slug - The mission.
 * @param notes - The complete new notes (a full replacement, as the tool has always been). `null` puts the mission back to having none, which is what undo means when it had none.
 * @returns The mission's name and its notes before the write, or null when there is no such mission.
 */
export async function rewriteWorkingNotes(orgId: string, slug: string, notes: string | null): Promise<{ name: string; previous: string | null } | null> {
  const [before] = await db
    .select({ name: missionSchema.name, workingNotes: missionSchema.workingNotes })
    .from(missionSchema)
    .where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, slug)))
    .limit(1);
  if (!before) {
    return null;
  }
  await db
    .update(missionSchema)
    .set({ workingNotes: notes })
    .where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, slug)));
  return { name: before.name, previous: before.workingNotes ?? null };
}

/* ------------------------------------------------------------------ */
/* Stranded-run reaper — mission runs a dead process left behind        */
/* ------------------------------------------------------------------ */

/**
 * How long a mission run is given without activity before it counts as
 * stranded. Mission runs execute in-process with no lease (unlike
 * `worker_run` — ADR 0004, `WorkerRunService.reapLostWorkerRuns`), so a server
 * restart or a crashed process leaves the row at `running` (or `planning` /
 * `paused` / `awaiting_review`) for ever. 28 rows were found stuck this way in
 * prod on 2026-09-28 — 15 `wiki-debrief`, 13 `increase-discovery-calls`, the
 * oldest since 10 July.
 *
 * Override with `VOCION_MISSION_RUN_REAP_AFTER_MS` for a fleet whose
 * legitimate single-task runs run longer.
 */
export const MISSION_RUN_REAP_AFTER_MS = (() => {
  const configured = Number(process.env.VOCION_MISSION_RUN_REAP_AFTER_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 30 * 60_000;
})();

/**
 * A stranded run that an EVENT automation started is worth replaying once —
 * `regenerate-brief-on-request` or `handoff-on-reply` answers one specific
 * payload that has nowhere else to come from, and loses it for good if the
 * run that was carrying it just dies. Older than this the event itself is
 * stale, so it is left alone instead.
 */
export const MISSION_RUN_REFIRE_WINDOW_MS = 24 * 60 * 60_000;

/** Every status but the three terminal ones — "still going" for a mission run. */
const REAPABLE_MISSION_RUN_STATUSES = ['planning', 'running', 'paused', 'awaiting_review'] as const;

export type MissionRunReapResult = {
  /** Runs marked `failed` this sweep. */
  reaped: number;
  /** Of those, how many were replayed because an event automation started them. */
  refired: number;
  ids: number[];
};

/**
 * Was there tool activity on this run inside the bound? A single long task
 * can run the whole bound without touching `mission_run` itself — the row is
 * only patched at a task's start and its end, never in between
 * (`services/missions/runtime.ts`) — so `updated_at` alone would reap a run
 * that is still working. Scoped by org plus a `created_at` floor so the read
 * rides the existing `tool_call_org_created_idx` rather than needing a new one.
 * @param orgId - The run's org.
 * @param missionRunId - The run.
 * @param cutoff - Activity at or after this time counts as inside the bound.
 */
async function hasRecentToolCallActivity(orgId: string, missionRunId: number, cutoff: Date): Promise<boolean> {
  const rows = await db
    .select({ id: toolCallSchema.id })
    .from(toolCallSchema)
    .where(and(
      eq(toolCallSchema.orgId, orgId),
      eq(toolCallSchema.missionRunId, missionRunId),
      gte(toolCallSchema.createdAt, cutoff),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Close out the `automation_run` a stranded run's own fire left `running`
 * (`mission_run.caused_by[0]`, stamped by `beginAutomationFire` on the exact
 * fire that started this run), and replay it once when it is worth replaying.
 *
 * A schedule fire (`wiki-debrief`, `process-new-mqls`, a mission's own
 * standing check) is superseded by its next scheduled fire regardless, so it
 * is only marked `error` here. An event fire is dispatched again — inside
 * {@link MISSION_RUN_REFIRE_WINDOW_MS} — as its own `automationFire` workflow
 * rather than run inline: a mission check can take up to 90 minutes
 * (`services/temporal/workflows/automationFire.ts`), and this sweep needs to
 * stay fast for every other stranded run behind it. The replay carries the
 * original fire's merged input (`automation_run.input` — kept exactly to
 * "reproduce a run from") and is stamped `invokedBy: reap-refire:<original>`,
 * which does not start with `event:` — so if the replay itself strands, this
 * same check reads it as a non-event fire and only marks it failed. A re-fire
 * is never re-fired.
 * @param orgId - The run's org.
 * @param automationRunId - The fire to close (`caused_by[0].automationRunId`).
 * @param missionRunId - The run that was just reaped.
 * @param now - The clock.
 */
async function closeAndMaybeRefireAutomationRun(orgId: string, automationRunId: number, missionRunId: number, now: Date): Promise<boolean> {
  const [automationRun] = await db
    .select()
    .from(automationRunSchema)
    .where(and(eq(automationRunSchema.id, automationRunId), eq(automationRunSchema.orgId, orgId)));
  if (!automationRun) {
    return false;
  }
  const closed = await db
    .update(automationRunSchema)
    .set({
      status: 'error',
      error: `mission run ${missionRunId} was stopped: the server restarted or the process died before it finished`,
      targetRunId: missionRunId,
      finishedAt: now,
    })
    .where(and(
      eq(automationRunSchema.id, automationRunId),
      eq(automationRunSchema.orgId, orgId),
      eq(automationRunSchema.status, 'running'),
    ))
    .returning({ id: automationRunSchema.id });
  if (closed.length === 0) {
    // Already closed — by this same sweep on an earlier pass, or by
    // AutomationService's own 70-minute abandoned-run sweep. Nothing to replay.
    return false;
  }

  const invokedBy = automationRun.invokedBy ?? '';
  const isEventFire = invokedBy.startsWith('event:');
  const withinReplayWindow = now.getTime() - automationRun.startedAt.getTime() <= MISSION_RUN_REFIRE_WINDOW_MS;
  if (!isEventFire || !withinReplayWindow) {
    return false;
  }

  try {
    const client = await getTemporalClient();
    await client.workflow.start(AUTOMATION_FIRE_WORKFLOW, {
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      workflowId: automationRefireWorkflowIdFor(orgId, automationRunId, missionRunId),
      args: [{
        orgId,
        slug: automationRun.slug,
        input: (automationRun.input as Record<string, unknown> | null) ?? {},
        invokedBy: `reap-refire:${invokedBy}`,
      }],
    });
    return true;
  } catch (error) {
    console.warn(`[mission-run-reaper] could not replay "${automationRun.slug}" after reaping mission run ${missionRunId}`, { error: (error as Error).message ?? error });
    return false;
  }
}

/**
 * Mark every mission run whose last activity lapsed as `failed` — the
 * mission-run analogue of `WorkerRunService.reapLostWorkerRuns` (ADR 0004) for
 * a run mode with no lease to lapse. Called by the Temporal Schedule in
 * `MissionRunReaperScheduleService`, same five-minute cadence as the
 * worker-run reaper; safe to call any time.
 *
 * "Last activity" is the later of the row's own `updated_at` (bumped on every
 * status/plan write, `services/missions/runtime.ts`) and its newest
 * `tool_call`, so a single long tool-heavy task is never reaped out from
 * under itself. The plan's own task statuses are left exactly as the crash
 * left them (`running`, `pending`, …) — the same thing the in-process crash
 * handler in `missions/runtime.ts` does when it settles a run it did not
 * expect to end — so a person reading the plan sees where it stopped.
 * @param now - The clock, injectable for tests.
 */
export async function reapStaleMissionRuns(now: Date = new Date()): Promise<MissionRunReapResult> {
  const cutoff = new Date(now.getTime() - MISSION_RUN_REAP_AFTER_MS);
  const candidates = await db
    .select({ id: missionRunSchema.id, orgId: missionRunSchema.orgId, causedBy: missionRunSchema.causedBy })
    .from(missionRunSchema)
    .where(and(
      inArray(missionRunSchema.status, [...REAPABLE_MISSION_RUN_STATUSES]),
      lt(missionRunSchema.updatedAt, cutoff),
    ));
  if (candidates.length === 0) {
    return { reaped: 0, refired: 0, ids: [] };
  }

  const minutes = Math.round(MISSION_RUN_REAP_AFTER_MS / 60_000);
  const error = `Stopped: the run was interrupted (no activity for ${minutes} min; the server restarted or the process died)`;
  const ids: number[] = [];
  let refired = 0;

  for (const candidate of candidates) {
    if (await hasRecentToolCallActivity(candidate.orgId, candidate.id, cutoff)) {
      continue;
    }

    const updated = await db
      .update(missionRunSchema)
      .set({ status: 'failed', error, completedAt: now })
      .where(and(
        eq(missionRunSchema.id, candidate.id),
        eq(missionRunSchema.orgId, candidate.orgId),
        inArray(missionRunSchema.status, [...REAPABLE_MISSION_RUN_STATUSES]),
      ))
      .returning({ id: missionRunSchema.id });
    if (updated.length === 0) {
      // Settled by something else between the read above and this write.
      continue;
    }
    ids.push(candidate.id);
    const link = candidate.causedBy?.[0];

    if (link?.automationRunId && await closeAndMaybeRefireAutomationRun(candidate.orgId, link.automationRunId, candidate.id, now)) {
      refired += 1;
    }
  }
  return { reaped: ids.length, refired, ids };
}
