import type { DeliveredEvent, DurableContext } from '@/libs/durable';
import { defineDurable } from '@/libs/durable';
import { MAX_WAIT_SECONDS } from '@/libs/durable/types';

/**
 * ONE OWNER PER REQUEST (backlog 054). In a workspace that runs the factory
 * as a durable workflow, a request from its first Build to live is this run:
 * it alone dispatches, it owns the attempt number and the branch each attempt
 * continues, and it waits — with a timeout and a stated stop — for what
 * happens next. Every other way into a build (Build, chat, intake, an ask's
 * answer, a recovery, QA's send-back, an approved plan) arrives as a
 * `factory.build_requested` event this run reads; none of them dispatches.
 *
 * Replaces, for such a workspace, the handoffs that lost work on 2026-10-01/02:
 * duplicate starts, a stale event rebuilding shipped work, a cancel retried,
 * a plan hold swallowing a retry, a retry restarting from main.
 */
export const REQUEST_WORKFLOW = 'factory.request';
export const BUILD_REQUESTED = 'factory.build_requested';

/** Automatic attempts in a row before the run stops and asks a person. */
export const AUTOMATIC_LIMIT = 3;
const HOUR = 60 * 60;
const RUN_LIMIT = 8 * HOUR;
const PLAN_LIMIT = 3 * HOUR;
const REVIEW_LIMIT = 30 * 24 * HOUR;
const RELEASE_LIMIT = 6 * HOUR;
const IDLE_LIMIT = 90 * 24 * HOUR;

/** A build asked for, by whom, and what this attempt should do differently. */
export type BuildIntent = {
  requestId: number;
  /** The person's id, or the factory step that asked. */
  by: string;
  byPerson: boolean;
  /** Where it came from: build, chat, recovery, qa, plan, ask, contract … */
  from: string;
  note?: string | null;
  planId?: number | null;
  trigger?: 'request' | 'recovery' | 'plan' | null;
};

export type RequestWorkflowInput = { orgId: string; requestId: number; since: string };

export type AttemptOutcome
  = | { kind: 'building'; workerRunId: number; taskId: number | null }
    | { kind: 'planning'; line: string }
    | { kind: 'refused'; why: string };

export type RunRead = { status: string; branch: string | null; prUrl: string | null; failure: string | null; decision: { do: string; why: string } };

/** What the run does in the world, injected in tests. */
export type RequestWorkflowDeps = {
  dispatch: (orgId: string, requestId: number, intent: BuildIntent, at: { attempt: number; base: string | null }) => Promise<AttemptOutcome>;
  readRun: (orgId: string, workerRunId: number, automaticSoFar: number) => Promise<RunRead>;
  stop: (orgId: string, requestId: number, why: string) => Promise<void>;
};

/**
 * The request's run: a loop of attempts, each answering the next build intent.
 * @param ctx - The durable context.
 * @param input - The request and when its first intent was raised.
 * @param deps - Dispatch, run reads and the stop.
 */
export async function runRequest(ctx: DurableContext, input: RequestWorkflowInput, deps: RequestWorkflowDeps): Promise<{ stage: string }> {
  const { orgId, requestId } = input;
  let attempt = 0;
  let automatic = 0;
  let base: string | null = null;
  let wait = 0;
  const status = (stage: string, line: string, extra: Record<string, unknown> = {}) => ctx.setStatus({ stage, line, attempt, base, ...extra });
  const forIntent = { types: [BUILD_REQUESTED], match: { requestId } };
  const waitFirst = async (label: string, any: Array<{ types: string[]; match: Record<string, unknown> }>, limitSeconds: number, since?: string): Promise<DeliveredEvent | null> => {
    for (let waited = 0; waited < limitSeconds; waited += MAX_WAIT_SECONDS) {
      const ev = await ctx.waitForEvent(`${label}-${wait++}`, { orgId, any, timeoutSeconds: Math.min(MAX_WAIT_SECONDS, limitSeconds - waited), since: waited === 0 ? since : undefined });
      if (ev) {
        return ev;
      }
    }
    return null;
  };
  const nextIntent = async (since?: string): Promise<BuildIntent | null> => {
    const ev = await waitFirst('intent', [forIntent], IDLE_LIMIT, since);
    return ev ? (ev.payload as BuildIntent) : null;
  };
  const stop = async (why: string): Promise<BuildIntent | null> => {
    await ctx.step(`stop-${attempt}-${wait}`, () => deps.stop(orgId, requestId, why));
    await status('stopped', why);
    return nextIntent();
  };

  let intent = await nextIntent(input.since);
  while (intent) {
    automatic = intent.byPerson ? 0 : automatic + 1;
    if (!intent.byPerson && automatic > AUTOMATIC_LIMIT) {
      intent = await stop(`Stopped after ${AUTOMATIC_LIMIT} automatic attempts in a row; Build again continues ${base ?? 'from main'}.`);
      continue;
    }
    attempt += 1;
    await status('starting', `Attempt ${attempt} (${intent.from})${base ? `, continuing ${base}` : ''}.`);
    const asked: BuildIntent = intent;
    const out = await ctx.step(`dispatch-${attempt}`, () => deps.dispatch(orgId, requestId, asked, { attempt, base }));
    intent = null;
    if (out.kind === 'refused') {
      attempt -= 1;
      intent = await stop(out.why);
      continue;
    }
    if (out.kind === 'planning') {
      // Planning is not an attempt: the plan's approval asks for the build.
      attempt -= 1;
      await status('planning', out.line);
      const ev = await waitFirst('plan', [forIntent], PLAN_LIMIT);
      intent = ev ? (ev.payload as BuildIntent) : await stop('The plan did not arrive within 3 hours.');
      continue;
    }
    await status('building', `RUN-${out.workerRunId} is building attempt ${attempt}.`, { workerRunId: out.workerRunId, taskId: out.taskId });
    const ended = await waitFirst(`run-${attempt}`, [{ types: ['worker_run.completed', 'worker_run.failed'], match: { workerRunId: out.workerRunId } }], RUN_LIMIT);
    const run = await ctx.step(`read-${attempt}`, () => deps.readRun(orgId, out.workerRunId, automatic));
    base = run.branch ?? base;
    if (!ended) {
      intent = await stop(`RUN-${out.workerRunId} did not finish within 8 hours.`);
      continue;
    }
    if (run.status === 'cancelled') {
      // A person's cancel is final: nothing retries it.
      await status('stopped', `RUN-${out.workerRunId} was cancelled; Build again continues ${base ?? 'from main'}.`);
      intent = await nextIntent();
      continue;
    }
    if (run.status !== 'completed' || !run.prUrl) {
      if (run.decision.do === 'dispatch') {
        intent = { requestId, by: 'factory:recovery', byPerson: false, from: 'recovery', note: run.failure, trigger: 'recovery' };
      } else {
        intent = await stop(run.decision.why);
      }
      continue;
    }
    await status('review', `QA is reviewing ${run.prUrl}.`, { prUrl: run.prUrl });
    const next = await waitFirst(`review-${attempt}`, [forIntent, { types: ['pr.merged'], match: { url: run.prUrl } }, { types: ['pr.closed'], match: { url: run.prUrl } }], REVIEW_LIMIT);
    if (!next) {
      intent = await stop(`${run.prUrl} was neither merged nor sent back within 30 days.`);
      continue;
    }
    if (next.type === BUILD_REQUESTED) {
      intent = next.payload as BuildIntent;
      continue;
    }
    if (next.type === 'pr.closed') {
      intent = await stop(`${run.prUrl} was closed without merging.`);
      continue;
    }
    await status('deploying', `Merged ${run.prUrl}; deploying.`, { prUrl: run.prUrl });
    const released = await waitFirst('release', [{ types: ['release.linked'], match: { requestIds: [requestId] } }], RELEASE_LIMIT);
    if (!released) {
      await status('merged', `Merged ${run.prUrl}; no release recorded it within 6 hours.`);
      return { stage: 'merged' };
    }
    await status('live', `Live in REL-${String(released.payload.releaseId ?? '?')}.`, { releaseId: released.payload.releaseId ?? null });
    return { stage: 'live' };
  }
  await status('idle', 'No build was asked for in 90 days; the run ended.');
  return { stage: 'idle' };
}

/** The production effects: today's dispatch action, run reads and the stop ask. */
export const productionDeps: RequestWorkflowDeps = {
  async dispatch(orgId, requestId, intent, at) {
    const { proposeAction } = await import('@/services/ActionService');
    const res = await proposeAction({
      orgId,
      actionId: 'factory.dispatch_task',
      input: {
        requestId,
        ...(intent.planId ? { planId: intent.planId } : {}),
        ...(intent.note ? { note: intent.note } : {}),
        // An ask no person made dispatches as automatic, so it never reopens a
        // settled request the way a person's Build does.
        ...(intent.trigger ? { trigger: intent.trigger } : intent.byPerson ? {} : { trigger: 'recovery' as const }),
        contract: { attempt: at.attempt, ...(at.base ? { baseSha: at.base } : {}) },
        reason: `Attempt ${at.attempt}, asked by ${intent.byPerson ? 'a person' : intent.by} (${intent.from}).`,
        fromWorkflow: true,
      },
      principal: { kind: 'agent', id: 'agent:factory-workflow', scope: { orgId }, grants: ['*'], autonomy: 5 },
      invokedBy: intent.by,
      internal: true,
    });
    if (res.status !== 'done') {
      return { kind: 'refused', why: res.error ?? `The build did not start (${res.status}).` };
    }
    const r = (res.result ?? {}) as { workerRunId?: unknown; planning?: unknown; why?: unknown; taskId?: unknown };
    if (r.planning === true) {
      return { kind: 'planning', line: `Planning first: ${String(r.why ?? 'the request needs a plan')}.` };
    }
    const workerRunId = Number(r.workerRunId);
    return Number.isInteger(workerRunId) && workerRunId > 0
      ? { kind: 'building', workerRunId, taskId: Number(r.taskId) > 0 ? Number(r.taskId) : null }
      : { kind: 'refused', why: 'The build started no worker run.' };
  },
  async readRun(orgId, workerRunId, automaticSoFar) {
    const { getWorkerRun } = await import('@/services/WorkerRunService');
    const { classifyFailure, recoveryDecision } = await import('./recovery');
    const run = await getWorkerRun(orgId, workerRunId);
    const result = (run?.result ?? {}) as Record<string, unknown>;
    const branch = typeof result.keptBranch === 'string' ? result.keptBranch : typeof result.branch === 'string' ? result.branch : null;
    const prUrl = typeof result.prUrl === 'string' ? result.prUrl : typeof result.pr_url === 'string' ? result.pr_url : null;
    const status = run?.status ?? 'unknown';
    if (status === 'completed' && prUrl) {
      return { status, branch, prUrl, failure: null, decision: { do: 'none', why: '' } };
    }
    const failure = classifyFailure({ status, error: run?.error ?? null, failures: (run?.failures ?? []) as never, result });
    const d = recoveryDecision({ failure, attempts: automaticSoFar });
    return { status, branch, prUrl, failure: failure.sentence, decision: { do: d.do, why: 'why' in d ? String(d.why) : failure.sentence } };
  },
  async stop(orgId, requestId, why) {
    const { stopRequestForPerson } = await import('./carry');
    await stopRequestForPerson(orgId, requestId, why);
  },
};

export const requestWorkflowDefinition = defineDurable<RequestWorkflowInput, { stage: string }>({
  name: REQUEST_WORKFLOW,
  run: (ctx, input) => runRequest(ctx, input, productionDeps),
});
