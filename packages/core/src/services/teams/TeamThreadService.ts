/**
 * TEAM THREADS — the loop (`libs/teams/thread.ts` holds the shape and the rule).
 *
 * A lead (its `open_team_thread` tool, from chat or a mission step) or an
 * automation (`do: { job: team-thread }`) opens a thread for one question. The
 * lead's specialists post in rounds, each reading every post before theirs;
 * after each round the lead settles it with the outcome or steers the next
 * round; and the thread ends on the first settle rule that holds — the lead's
 * word, every member complete, the budget cap, the round cap, or a person's
 * cancel. Whatever ended it, the lead writes the outcome.
 *
 * ONE RUN. The thread is a `mission_run` row: each post is a plan step (so the
 * run page draws it, with that turn's tool calls under it), the whole thread
 * runs inside one cost scope (`budget/runCost.ts`) so every turn and every read
 * is counted once, on that run, and nowhere else — a chat turn that opened it
 * does not count it again. The run's `thread` column holds what only a thread
 * has. Its owner is the lead, with the team's accountable human beside it.
 *
 * Every turn goes through `runAgentDeep`, the seam a chat turn and a mission
 * task go through, so each member answers wherever its own `harness.runsOn`
 * says — in this process or on the agentcore container — with its own tools,
 * under the opener's source ACL, and every tool call it makes lands on the
 * thread's run (`missionRunId`).
 *
 * Whether a member said its part is complete, and whether the lead settled it,
 * is read by a model (`threadRead.ts`), never matched.
 */

import type { LeadReviewRead, MemberPostRead } from './threadRead';
import type { AgentNames, TeamThreadState, ThreadBrief, ThreadOptions, ThreadSettleReason, ThreadTask } from '@/libs/teams/thread';
import type { CausalChain } from '@/services/automations/fireGuards';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  boundThreadOptions,
  leadReviewMessage,
  memberMessage,
  outcomeMessage,
  postId,
  settleReason,
  THREAD_LIMITS,
  threadViewOf,
} from '@/libs/teams/thread';
import { agentSchema, missionRunSchema, projectSchema, teamSchema, userSchema } from '@/models/Schema';
import { currentRunCost, withRunCost } from '@/services/budget/runCost';
import { describeTaskFailure } from '@/services/missions/failure';

/**
 * Log through a dynamic import, as `missions/runtime.ts` does: the automation
 * job that opens a thread sits in the durable executor's import chain.
 * @param level - Which logger method.
 * @param message - What happened.
 * @param properties - Identifiers worth keeping.
 */
function log(level: 'error' | 'warn' | 'info', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger').then(({ logger }) => logger[level](message, properties)).catch(() => {});
}

/** A thread could not be opened, said in words the opener can act on. */
export class TeamThreadError extends Error {
  override name = 'TeamThreadError';
}

/** One turn of one agent in the thread — `runAgentDeep`'s shape, the part a thread uses. */
export type ThreadTurn = (opts: {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  allowedSourceSlugs?: string[];
  missionRunId: number;
}) => Promise<{ response: string; traceId?: string }>;

/** A post as it lands, for whoever is watching (the opener's progress line). */
export type ThreadPostNotice = { kind: 'post' | 'review' | 'outcome'; round: number | null; agentSlug: string; agentName: string; failed: boolean };

/** What the loop calls out to. Every field defaults to the real thing; tests hand in their own. */
export type ThreadDeps = {
  runTurn?: ThreadTurn;
  readMember?: (input: { orgId: string; member: string; question: string; post: string }) => Promise<MemberPostRead>;
  readLead?: (input: { orgId: string; lead: string; question: string; review: string }) => Promise<LeadReviewRead>;
  onPost?: (post: ThreadPostNotice) => void;
};

/** How a thread ended. */
export type TeamThreadResult = {
  runId: number;
  status: 'completed' | 'failed' | 'cancelled';
  settledBy: ThreadSettleReason | null;
  outcome: string | null;
  rounds: number;
  /** What the whole thread cost, every turn and read, in micro-cents. */
  microCents: number;
  error: string | null;
};

/* ------------------------------------------------------------------ */
/* Who is in it                                                          */
/* ------------------------------------------------------------------ */

/** The team a thread is opened with. */
export type ThreadTeam = {
  lead: string;
  members: string[];
  /** Asked-for members the lead cannot reach, and members past the cap — named, never silently dropped. */
  left: string[];
  teamSlug: string | null;
  accountableUserId: string | null;
  names: AgentNames;
};

/**
 * Who a thread with this lead assigns, from the registry — the same roster the
 * lead delegates to (`agents/delegationRoster.ts`), never a list the model
 * typed. A team lead's own members (and registered children); the workspace
 * lead's team leads. `wanted` narrows it to named members of that roster;
 * anything outside it comes back in `left`. At most
 * {@link THREAD_LIMITS.maxMembers}.
 * @param orgId - Tenant: every row read is this org's.
 * @param leadSlug - The lead.
 * @param wanted - The members asked for, when the opener named some.
 */
export async function resolveThreadTeam(orgId: string, leadSlug: string, wanted?: readonly string[]): Promise<ThreadTeam> {
  const [lead] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, leadSlug))).limit(1);
  if (!lead) {
    throw new TeamThreadError(`There is no agent "${leadSlug}" in this workspace to lead a thread.`);
  }
  const { deriveDelegationRoster } = await import('@/services/agents/delegationRoster');
  const roster = await deriveDelegationRoster(orgId, lead);
  const leads = roster.delegates.filter(d => d.source === 'team-lead');
  const pool = leads.length > 0 && !wanted?.length ? leads : roster.delegates;
  const inRoster = new Set(pool.map(d => d.slug));
  const asked = wanted?.length ? [...new Set(wanted)] : pool.map(d => d.slug);
  const reachable = asked.filter(s => inRoster.has(s) && s !== leadSlug);
  const members = reachable.slice(0, THREAD_LIMITS.maxMembers);
  const left = [...asked.filter(s => !inRoster.has(s) || s === leadSlug), ...reachable.slice(THREAD_LIMITS.maxMembers)];
  if (members.length === 0) {
    throw new TeamThreadError(wanted?.length
      ? `None of ${wanted.join(', ')} is on ${lead.name}'s team, so there is no one to open the thread with. Name members from the team, or leave members out to assign the whole team.`
      : `${lead.name} has no specialists to open a thread with. Answer it directly, or ask one agent with the task tool.`);
  }
  const [team] = await db.select({ slug: teamSchema.slug, accountableUserId: teamSchema.accountableUserId })
    .from(teamSchema)
    .where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.leadAgentSlug, leadSlug)))
    .orderBy(teamSchema.id)
    .limit(1);
  const [project] = await db.select({ accountableUserId: projectSchema.accountableUserId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  const names = new Map<string, string>([[lead.slug, lead.name], ...roster.delegates.map(d => [d.slug, d.name] as [string, string])]);
  return {
    lead: leadSlug,
    members,
    left,
    teamSlug: team?.slug ?? null,
    // The team's human, else the workspace's — resolved once, when the thread opens.
    accountableUserId: team?.accountableUserId ?? project?.accountableUserId ?? null,
    names,
  };
}

/* ------------------------------------------------------------------ */
/* Open                                                                  */
/* ------------------------------------------------------------------ */

/** What opening a thread takes. */
export type OpenTeamThreadInput = ThreadOptions & {
  orgId: string;
  /** The agent that opens, owns and settles it. */
  lead: string;
  question: string;
  /** Narrow the team to these members; omitted assigns the lead's whole team. */
  members?: string[];
  /** `agent:<slug>` (a lead's tool call) or `job:team-thread` (an automation). */
  openedBy: string;
  /** The person behind it, when one is: every turn runs as them. */
  userId?: string;
  /** That person's source ACL; carried to every turn. */
  allowedSourceSlugs?: string[];
  /** The run it was opened from (a mission step). */
  parentRunId?: number;
  /** The conversation it was opened from (a lead's chat turn). */
  conversationId?: number;
  /** The automation fires behind it, newest first. */
  causedBy?: CausalChain | null;
};

/**
 * Open a thread: resolve its team, write its run, and return before any turn
 * runs. {@link runTeamThread} runs it; {@link startTeamThread} does both.
 * Refused, in words, when the workspace is paused, the question is empty or
 * the lead has no one to ask.
 * @param input - The thread.
 * @returns The run, the members assigned and those left out.
 */
export async function openTeamThread(input: OpenTeamThreadInput): Promise<{ runId: number; title: string; team: ThreadTeam }> {
  const question = input.question.trim();
  if (!question) {
    throw new TeamThreadError('A thread needs a question.');
  }
  const { assertWorkspaceRunning } = await import('@/services/workspacePause');
  await assertWorkspaceRunning(input.orgId, 'mission_run');
  const team = await resolveThreadTeam(input.orgId, input.lead, input.members);
  const opts = boundThreadOptions(input);
  const thread: TeamThreadState = {
    question,
    lead: team.lead,
    teamSlug: team.teamSlug,
    accountableUserId: team.accountableUserId,
    members: team.members,
    turnOrder: opts.turnOrder,
    maxRounds: opts.maxRounds,
    capCents: opts.capCents,
    round: 0,
    complete: [],
    settledBy: null,
    settledAt: null,
    outcome: null,
    openedBy: input.openedBy,
    userId: input.userId ?? null,
    allowedSourceSlugs: input.allowedSourceSlugs ?? null,
    parentRunId: input.parentRunId ?? null,
    conversationId: input.conversationId ?? null,
  };
  const title = `Team thread: ${question.length > 70 ? `${question.slice(0, 70)}…` : question}`;
  const { getCurrentWorkspaceSha } = await import('@/libs/workspace');
  const workspaceSha = await getCurrentWorkspaceSha(input.orgId).catch(() => null);
  const [row] = await db.insert(missionRunSchema).values({
    orgId: input.orgId,
    title,
    brief: question,
    status: 'running',
    plan: { tasks: [] },
    team: { lead: team.lead, members: team.members },
    autonomyPolicy: {},
    workspaceSha,
    createdBy: input.userId ?? input.openedBy,
    causedBy: input.causedBy && input.causedBy.length > 0 ? input.causedBy : null,
    thread,
  }).returning({ id: missionRunSchema.id });
  return { runId: row!.id, title, team };
}

/**
 * Open a thread and run it. Resolves once the run exists, with `done` for its
 * end — so a caller that cannot wait for the whole thread (a tool call on the
 * agentcore container, an HTTP request) holds the run and lets it settle on
 * its own.
 * @param input - The thread.
 * @param deps - Injected in tests.
 */
export async function startTeamThread(input: OpenTeamThreadInput, deps: ThreadDeps = {}): Promise<{ runId: number; title: string; team: ThreadTeam; done: Promise<TeamThreadResult> }> {
  const opened = await openTeamThread(input);
  const done = runTeamThread(input.orgId, opened.runId, { ...deps, names: opened.team.names });
  // Whoever drops `done` must not leave an unhandled rejection behind; the
  // loop records its own failures on the run.
  done.catch(() => {});
  return { ...opened, done };
}

/* ------------------------------------------------------------------ */
/* Run                                                                   */
/* ------------------------------------------------------------------ */

type RunRow = typeof missionRunSchema.$inferSelect;

/**
 * The default turn: `runAgentDeep`, imported when first used so this module
 * adds no static edge into the agent runtime.
 * @param opts - The turn.
 */
const defaultTurn: ThreadTurn = async (opts) => {
  const { runAgentDeep } = await import('@/services/AgentService');
  return runAgentDeep(opts);
};

/**
 * Run a thread to its settle rule and the lead's outcome. Inside one cost
 * scope for the run, so the thread's spend is counted once, on its row,
 * whoever opened it. Never throws for the thread's own failures: a turn that
 * fails is a failed post on the run, and a thread whose outcome could not be
 * written ends `failed`, saying why.
 * @param orgId - Tenant.
 * @param runId - The thread's run.
 * @param deps - Injected in tests; `names` saves re-reading them.
 */
export async function runTeamThread(orgId: string, runId: number, deps: ThreadDeps & { names?: AgentNames } = {}): Promise<TeamThreadResult> {
  return withRunCost({ missionRunId: runId }, async (scope) => {
    try {
      return await loop(orgId, runId, deps);
    } catch (err) {
      const error = describeTaskFailure(err);
      log('error', 'team thread crashed — marking its run failed rather than leaving it running', { orgId, runId, error });
      await db.update(missionRunSchema)
        .set({ status: 'failed', error, completedAt: new Date() })
        .where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, 'running')))
        .catch(() => {});
      return { runId, status: 'failed', settledBy: null, outcome: null, rounds: 0, microCents: scope.microCents, error };
    }
  });
}

async function loop(orgId: string, runId: number, deps: ThreadDeps & { names?: AgentNames }): Promise<TeamThreadResult> {
  const [run] = await db.select().from(missionRunSchema).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId))).limit(1);
  if (!run?.thread) {
    throw new Error(`team thread ${runId} not found in org ${orgId}`);
  }
  const state: TeamThreadState = { ...run.thread, complete: [...run.thread.complete] };
  const tasks: ThreadTask[] = [...(run.plan?.tasks ?? [])] as ThreadTask[];
  const names = deps.names ?? await agentNames(orgId, [state.lead, ...state.members]);
  const runTurn = deps.runTurn ?? defaultTurn;
  const { readLeadReview, readMemberPost } = await import('./threadRead');
  const readMember = deps.readMember ?? (i => readMemberPost(i));
  const readLead = deps.readLead ?? (i => readLeadReview(i));
  const spent = () => currentRunCost()?.microCents ?? 0;

  // One writer, in order: the run's plan and thread are written whole after
  // every change, and a later write never lands before an earlier one.
  let writes: Promise<void> = Promise.resolve();
  const save = () => {
    const plan = { tasks: tasks.map(t => ({ ...t })) };
    const thread = { ...state, complete: [...state.complete] };
    writes = writes.then(() => db.update(missionRunSchema).set({ plan, thread }).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId))).then(() => {}));
    return writes;
  };
  const cancelled = async () => {
    const [now] = await db.select({ status: missionRunSchema.status }).from(missionRunSchema).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId))).limit(1);
    return now?.status === 'cancelled';
  };
  const brief = (): ThreadBrief => ({ question: state.question, lead: state.lead, members: state.members, round: state.round, maxRounds: state.maxRounds, names, tasks });
  const settleNow = async (leadSettled = false) => settleReason({
    round: state.round,
    maxRounds: state.maxRounds,
    members: state.members,
    complete: state.complete,
    leadSettled,
    spentMicroCents: spent(),
    capCents: state.capCents,
    cancelled: await cancelled(),
  });
  const turn = (agentSlug: string, message: string) => runTurn({
    orgId,
    agentSlug,
    message,
    userId: state.userId ?? 'team-thread',
    allowedSourceSlugs: state.allowedSourceSlugs ?? undefined,
    missionRunId: runId,
  });
  const notice = (task: ThreadTask, kind: ThreadPostNotice['kind'], round: number | null) => {
    try {
      deps.onPost?.({ kind, round, agentSlug: task.ownerAgentSlug, agentName: names.get(task.ownerAgentSlug) ?? task.ownerAgentSlug, failed: task.status === 'failed' });
    } catch {
      // A watcher's failure is not the thread's.
    }
  };

  /**
   * One member's post: run the turn, read it, write it down.
   * @param member - Who posts.
   * @param round - The round it is in.
   * @param message - What the member is given to read.
   */
  const post = async (member: string, round: number, message: string) => {
    const task: ThreadTask = { id: postId.post(round, member), title: `Round ${round}`, ownerAgentSlug: member, type: 'analysis', status: 'running', startedAt: new Date().toISOString() };
    tasks.push(task);
    await save();
    try {
      const result = await turn(member, message);
      task.output = result.response;
      task.traceId = result.traceId;
      task.status = 'completed';
      const read = await readMember({ orgId, member, question: state.question, post: result.response });
      if (read.complete && !state.complete.includes(member)) {
        state.complete.push(member);
        task.title = `Round ${round} — marked complete`;
      }
    } catch (err) {
      task.status = 'failed';
      task.error = describeTaskFailure(err);
      log('warn', 'team thread post failed', { orgId, runId, member, round, error: task.error });
    }
    task.endedAt = new Date().toISOString();
    await save();
    notice(task, 'post', round);
  };

  let reason: ThreadSettleReason | null = await settleNow();
  let outcomeFromReview: string | null = null;
  while (!reason) {
    const round = state.round + 1;
    const active = state.members.filter(m => !state.complete.includes(m));
    if (state.turnOrder === 'parallel') {
      // Everyone reads the thread as it stood when the round began.
      const asOf = { ...brief(), round, tasks: [...tasks] };
      const messages = active.map(m => memberMessage(asOf, m));
      await Promise.all(active.map((m, i) => post(m, round, messages[i]!)));
    } else {
      for (const m of active) {
        // Between posts, a cap or a cancel ends the round where it is.
        if (await cancelled() || spent() >= state.capCents * 1_000_000) {
          break;
        }
        await post(m, round, memberMessage({ ...brief(), round }, m));
      }
    }
    state.round = round;
    await save();

    reason = await settleNow();
    if (reason) {
      break;
    }
    // The lead's turn: settle it with the outcome, or steer the next round.
    const review: ThreadTask = { id: postId.review(round), title: `Round ${round} review`, ownerAgentSlug: state.lead, type: 'synthesis', status: 'running', startedAt: new Date().toISOString() };
    tasks.push(review);
    await save();
    let settled = false;
    try {
      const result = await turn(state.lead, leadReviewMessage(brief(), state.complete));
      review.output = result.response;
      review.traceId = result.traceId;
      review.status = 'completed';
      settled = (await readLead({ orgId, lead: state.lead, question: state.question, review: result.response })).settled;
    } catch (err) {
      review.status = 'failed';
      review.error = describeTaskFailure(err);
      log('warn', 'team thread lead review failed — the thread goes on to its next rule', { orgId, runId, round, error: review.error });
    }
    review.endedAt = new Date().toISOString();
    if (settled) {
      // The review that settled it IS the outcome; the step says so.
      review.id = postId.outcome();
      review.title = 'Outcome';
      outcomeFromReview = review.output ?? null;
    }
    await save();
    notice(review, settled ? 'outcome' : 'review', settled ? null : round);
    reason = await settleNow(settled);
  }

  if (reason === 'cancelled') {
    state.settledBy = 'cancelled';
    state.settledAt = new Date().toISOString();
    await save();
    return { runId, status: 'cancelled', settledBy: 'cancelled', outcome: null, rounds: state.round, microCents: spent(), error: null };
  }

  // Whatever settled it, the lead writes the outcome — in its review when its
  // word settled it, else in one more turn that is told which rule held.
  let outcome = outcomeFromReview;
  let error: string | null = null;
  if (reason !== 'lead') {
    const task: ThreadTask = { id: postId.outcome(), title: 'Outcome', ownerAgentSlug: state.lead, type: 'synthesis', status: 'running', startedAt: new Date().toISOString() };
    tasks.push(task);
    await save();
    try {
      const result = await turn(state.lead, outcomeMessage(brief(), reason, state));
      task.output = result.response;
      task.traceId = result.traceId;
      task.status = 'completed';
      outcome = result.response;
    } catch (err) {
      task.status = 'failed';
      task.error = describeTaskFailure(err);
      error = `The thread settled (${reason}) but the lead's outcome could not be written: ${task.error.split('\n')[0]}`;
    }
    task.endedAt = new Date().toISOString();
    notice(task, 'outcome', null);
  }
  state.settledBy = reason;
  state.settledAt = new Date().toISOString();
  state.outcome = outcome;
  // A thread that settled without its outcome did not deliver: it is failed,
  // and says why. A person's cancel that landed meanwhile is left standing.
  const status = outcome ? 'completed' : 'failed';
  error ??= outcome ? null : `The thread settled (${reason}) but the lead wrote no outcome.`;
  await save();
  const ended = await db.update(missionRunSchema)
    .set({ status, completedAt: new Date(), error })
    .where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, 'running')))
    .returning({ id: missionRunSchema.id });
  return { runId, status: ended.length > 0 ? status : 'cancelled', settledBy: reason, outcome, rounds: state.round, microCents: spent(), error };
}

async function agentNames(orgId: string, slugs: readonly string[]): Promise<AgentNames> {
  const rows = slugs.length > 0
    ? await db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, [...slugs])))
    : [];
  return new Map(rows.map(r => [r.slug, r.name]));
}

/* ------------------------------------------------------------------ */
/* Read                                                                  */
/* ------------------------------------------------------------------ */

/**
 * One thread as a page or an API reads it, or null when this org holds no
 * thread run with that id — another org's run is the same null as none.
 * @param orgId - Tenant.
 * @param runId - The run.
 */
export async function getTeamThread(orgId: string, runId: number): Promise<ReturnType<typeof threadViewOf>> {
  const [run] = await db.select().from(missionRunSchema).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId))).limit(1);
  return run ? threadViewOfRun(orgId, run) : null;
}

/**
 * The view of a run already in hand, with its agents' names.
 * @param orgId - Tenant.
 * @param run - The run row.
 */
export async function threadViewOfRun(orgId: string, run: RunRow): Promise<ReturnType<typeof threadViewOf>> {
  if (!run.thread) {
    return null;
  }
  const names = await agentNames(orgId, [run.thread.lead, ...run.thread.members]);
  const accountableId = run.thread.accountableUserId;
  const [person] = accountableId
    ? await db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, accountableId)).limit(1)
    : [];
  return threadViewOf({ id: run.id, status: run.status, thread: run.thread, plan: run.plan as { tasks: ThreadTask[] } | null, microCents: run.microCents ?? null }, names, person?.name ?? person?.email ?? null);
}
