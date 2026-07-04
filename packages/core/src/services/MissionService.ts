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

export function listMissionRuns(orgId: string, opts: { status?: string; limit?: number } = {}) {
  const where = opts.status
    ? and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, opts.status))
    : eq(missionRunSchema.orgId, orgId);
  return db.select().from(missionRunSchema).where(where).orderBy(desc(missionRunSchema.createdAt)).limit(opts.limit ?? 50);
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

  if (opts.missionSlug) {
    const template = await getMission(opts.orgId, opts.missionSlug);
    if (!template) {
      throw new Error(`mission template "${opts.missionSlug}" not found`);
    }
    missionId = template.id;
    team = team ?? template.defaultTeam;
    goal = template.goal;
    autonomyLevel = autonomyLevel ?? (template.autonomyPolicy as { level?: number } | null)?.level;
    charter = { successCriteria: template.successCriteria ?? [], name: template.name };
  }
  if (!team?.lead) {
    throw new Error('a mission needs a team (lead + members) or a template slug');
  }
  const level = clampAutonomyLevel(autonomyLevel);
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);

  const [run] = await db.insert(missionRunSchema).values({
    orgId: opts.orgId,
    missionId,
    title: opts.title ?? opts.brief.slice(0, 80),
    brief: opts.brief,
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
    : await planMission({ orgId: opts.orgId, brief: opts.brief, goal, team, userId: opts.invokedBy });
  await db.update(missionRunSchema).set({ plan: { tasks }, status: 'running' }).where(eq(missionRunSchema.id, run!.id));
  await executeMissionRun(run!.id, opts.orgId);

  return (await getMissionRun(run!.id, opts.orgId))!;
}

/**
 * The standing brief a scheduled check carries — built from the mission
 * charter so the lead knows this is a periodic check, not a fresh project.
 * @param template
 * @param template.name
 * @param template.goal
 * @param template.successCriteria
 * @param template.workingNotes
 */
export function scheduledCheckBrief(template: { name: string; goal: string; successCriteria?: string[] | null; workingNotes?: string | null }): string {
  return [
    `Scheduled check of your standing mission "${template.name}".`,
    `Charter: ${template.goal}`,
    template.successCriteria?.length
      ? `Responsibilities:\n${template.successCriteria.map(c => `- ${c}`).join('\n')}`
      : '',
    template.workingNotes
      ? `WORKING NOTES from your previous checks (your memory — trust it):\n${template.workingNotes}`
      : 'WORKING NOTES: none yet — this is your first tracked check.',
    `This is a periodic check, not a fresh project. Review the current state against your working notes, do ONLY what is needed right now (use your skills, propose actions for anything touching external systems), and finish with a short report. If nothing needs doing, say so in one paragraph and stop.`,
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
