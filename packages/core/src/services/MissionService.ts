/**
 * MissionService — the open-ended, team work mode.
 *
 * A Mission is a goal-driven assignment a team of agents plans and works under
 * human review. It reuses the agent runtime (runAgentDeep), the autonomy ladder,
 * and the workspace_sha audit stamp. Workflows are what successful missions get
 * promoted* into (promoteMissionToWorkflow drafts one).
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { missionRunSchema, missionSchema, workflowSchema } from '@/models/Schema';
import { clampAutonomyLevel } from './missions/autonomy';
import { planMission } from './missions/planner';
import { leadlessTeamsNote, resolveMissionRoster } from './missions/roster';
import { executeMissionRun } from './missions/runtime';

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
  return db.select().from(missionRunSchema).where(and(...conditions)).orderBy(desc(missionRunSchema.createdAt)).limit(opts.limit ?? 50);
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
 * to field names an outside caller — the Veerio source registry, for one —
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

function toMissionRunReport(run: MissionRunSummary, missionSlug: string | null): MissionRunReport {
  return {
    id: run.id,
    missionSlug,
    status: run.status,
    startedAt: run.createdAt,
    finishedAt: run.completedAt,
    error: run.error,
    invokedBy: run.createdBy,
    // The column has no DB-level NOT NULL (only a default), so the type
    // allows null even though every insert path sets it — fall back to an
    // empty plan rather than let a caller's `.tasks` throw on it.
    plan: run.plan ?? { tasks: [] },
  };
}

/**
 * Resolve one mission run's slug by looking up its mission template. Missions
 * can start ad-hoc with no template (see `missionRunSchema.missionId`), so
 * `missionId === null` resolves to a null slug rather than a lookup.
 * @param missionId
 */
async function missionSlugFor(missionId: number | null): Promise<string | null> {
  if (missionId === null) {
    return null;
  }
  const mission = await db.query.missionSchema.findFirst({
    where: eq(missionSchema.id, missionId),
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
  const missionSlug = await missionSlugFor(run.missionId);
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
}): Promise<MissionRunSummary> {
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
  await db.update(missionRunSchema).set({ plan: { tasks }, status: 'running' }).where(eq(missionRunSchema.id, run!.id));
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
 */
export function scheduledCheckBrief(
  template: { name: string; goal: string; successCriteria?: string[] | null; workingNotes?: string | null },
  executionPrompt?: string,
): string {
  return [
    `Scheduled check of your standing mission "${template.name}".`,
    `Charter: ${template.goal}`,
    template.successCriteria?.length
      ? `Responsibilities:\n${template.successCriteria.map(c => `- ${c}`).join('\n')}`
      : '',
    template.workingNotes
      ? `WORKING NOTES from your previous checks (your memory — trust it):\n${template.workingNotes}`
      : 'WORKING NOTES: none yet — this is your first tracked check.',
    executionPrompt
      ? `YOUR ORDERS FOR THIS CHECK:\n${executionPrompt}`
      : `This is a periodic check, not a fresh project. Review the current state against your working notes, do ONLY what is needed right now (use your skills, propose actions for anything touching external systems), and finish with a short report. If nothing needs doing, say so in one paragraph and stop.`,
    `BEFORE you finish: call update_mission_notes with your REWRITTEN working notes — carry forward every still-open thread (and say how many consecutive checks it has been open, escalating language as it ages), every commitment with its due date, and DROP anything resolved. Keep it under ~40 lines.`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Approve the gated task and continue execution.
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
    }
  }
  await db.update(missionRunSchema).set({ plan: { tasks }, pauseReason: null, pausedAt: null }).where(eq(missionRunSchema.id, runId));
  await executeMissionRun(runId, orgId);
  return (await getMissionRun(runId, orgId))!;
}

export async function cancelMission(runId: number, orgId: string, reason?: string): Promise<MissionRunSummary> {
  await db.update(missionRunSchema)
    .set({ status: 'cancelled', error: reason ?? 'cancelled by user', completedAt: new Date() })
    .where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId)));
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
