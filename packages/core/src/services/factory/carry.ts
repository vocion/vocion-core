/**
 * THE FACTORY CARRIES A REQUEST THROUGH (backlog 038). The half that reads
 * and writes the records; the decisions are pure, in `recovery.ts`.
 *
 * Chris, 2026-09-28: "Your job is to fix Vocion so that it does its job. On
 * new requests. And can recover and continue on failed requests." Every path
 * here is code, run by a plugin automation's job on a typed event — never an
 * agent choosing to press something:
 *
 *   object.created (request)   → intakeFiledRequest   start the fix, or file the Build card
 *   factory.dispatch_task      → startPlanning        (from the dispatch) plan first when the rule says so
 *   object.created (plan)      → reviewFiledPlan      the plan's approval, on the trust bar
 *   plan.approved              → buildFromApprovedPlan the build dispatches itself with the plan
 *   worker_run.failed          → recoverFailedRun     classify, recover within the limit, or ask once
 *   ask.decided (the stop)     → answerRecoveryAsk    the person's answer starts the count again
 *   schedule                   → sweepStuckRequests   the same, for requests already stuck
 *
 * Every step writes one line on the request's own account (`recovery.log`,
 * the feature page's Activity) and, when it is about a run, on the run
 * (`result.recovery`, the run page), so "why did this start" and "why did
 * this stop" are both one move from where they are read.
 */

import type { Failure, RecoveryState } from './recovery';
import type { FactoryRecord } from '@/libs/actions/factory-dispatch';
import type { ProposeResult } from '@/services/ActionService';
import type { AskDecidedPayload, ObjectCreatedPayload } from '@/services/EventService';
import { classifyFailure, contractDelta, environmentDelta, INFRASTRUCTURE_FAILURES, intakeDecision, logLine, markHandled, personActed, readRecovery, recoveryDecision, stopOptions, unblockFor, workerRebuiltSince } from './recovery';

/** The seat whose judgement the factory's own proposals represent. */
const PM = 'product-manager';
const DISPATCH = 'factory.dispatch_task';
const APPROVE_PLAN = 'factory.approve_plan';
const LIVE_RUN = new Set(['queued', 'running', 'paused', 'awaiting_review']);
const CLOSED = new Set(['deferred', 'answered', 'out_of_scope', 'shipped']);
/** A lost run may still be re-claimed by its worker for a while; wait this long first. */
const LOST_GRACE_MS = 15 * 60_000;
/**
 * How far back the sweep looks. A run that failed longer ago than this was
 * left, not stuck: restarting it on the day this ships would spend money on
 * work nobody has thought about in weeks.
 */
const SWEEP_WINDOW_MS = 14 * 24 * 60 * 60_000;
/** A plan asked for and never written is said, not waited on forever. */
const PLAN_STALE_MS = 24 * 60 * 60_000;

type Meta = Record<string, unknown>;
type Row = { id: number; title: string; status: string | null; meta: Meta; createdAt: Date | null };
type RunRow = { id: number; status: string; kind: string; error: string | null; failures: Array<{ scope?: string; message?: string }>; input: Meta; result: Meta | null; updatedAt: Date; createdAt: Date; workerVersion?: string | null };

/** What a factory step did, for the job's result and the automation log. */
export type CarryResult = { requestId: number | null; did: string; line: string | null };

const skip = (requestId: number | null, did: string): CarryResult => ({ requestId, did, line: null });

async function lib() {
  return import('@/libs/actions/factory-dispatch');
}

/**
 * Propose one of the factory's actions as the PM seat, with a confidence the
 * trust ladder judges: above the rule's bar it executes with Undo, below it
 * it is a card.
 * @param orgId - Tenant.
 * @param actionId - The action.
 * @param input - Its input.
 * @param env - The envelope.
 * @param env.confidence - How sure the factory is.
 * @param env.rationale - Why the payload is right.
 * @param env.reason - Why it should be approved (or, with `decision: reject`, sent back).
 * @param env.decision - The recommendation.
 */
async function propose(orgId: string, actionId: string, input: Meta, env: { confidence: number; rationale: string; reason: string; decision?: 'approve' | 'reject' }): Promise<{ ok: true; res: ProposeResult } | { ok: false; error: string }> {
  try {
    const { proposeAction } = await import('@/services/ActionService');
    const res = await proposeAction({
      orgId,
      actionId,
      input,
      principal: { kind: 'agent', id: `agent:${PM}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
      // The factory's own step, in the PM's name but not the PM's turn: it is
      // bounded by the attempt limit, not by the agent's Review budget, and
      // `factory.approve_plan` refuses an agent proposing it on its own.
      invokedBy: `factory:${PM}`,
      proposal: { confidence: env.confidence, rationale: env.rationale, agentSlug: PM, suggestedDecision: env.decision ?? 'approve', suggestedDecisionReason: env.reason },
    });
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Read the request fresh, change its recovery state, write it back. Fresh
 * every time, because a dispatch this step proposed has written it since.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param change - The change.
 */
async function updateRecovery(orgId: string, requestId: number, change: (s: RecoveryState) => RecoveryState): Promise<RecoveryState | null> {
  const { readRecord, writeMeta } = await lib();
  const request = await readRecord(orgId, requestId);
  if (!request) {
    return null;
  }
  const next = change(readRecovery(request.meta));
  await writeMeta(orgId, requestId, { recovery: next });
  return next;
}

/**
 * The line on the run page: what the factory did about this run.
 * @param orgId - Tenant.
 * @param runId - The run.
 * @param line - The sentence.
 */
async function recordRunLine(orgId: string, runId: number, line: string): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { workerRunSchema } = await import('@/models/Schema');
  await db.update(workerRunSchema)
    .set({ result: sql`coalesce(${workerRunSchema.result}, '{}'::jsonb) || ${JSON.stringify({ recovery: { line, at: new Date().toISOString() } })}::jsonb` })
    .where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.id, runId)));
}

/**
 * Everything already in motion for one request: its tasks and their runs,
 * its plans, the asks open on it and any dispatch or plan approval waiting.
 * @param orgId - Tenant.
 * @param requestId - The request.
 */
async function workFor(orgId: string, requestId: number): Promise<{ tasks: Row[]; runs: RunRow[]; plans: Row[]; openAsks: number[]; waiting: boolean }> {
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, askSchema, workerRunSchema } = await import('@/models/Schema');
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const toRow = (r: { id: number; title: string; status: string | null; metadata: unknown; createdAt: Date | null }): Row => ({ id: r.id, title: r.title, status: r.status, meta: (r.metadata ?? {}) as Meta, createdAt: r.createdAt });
  const tasks = ((await listBusinessObjects(orgId, 'engineering_task').catch(() => [])) as Array<Parameters<typeof toRow>[0]>).map(toRow).filter(t => Number(t.meta.requestId) === requestId);
  const plans = ((await listBusinessObjects(orgId, 'architecture_plan').catch(() => [])) as Array<Parameters<typeof toRow>[0]>).map(toRow).filter(p => Number(p.meta.requestId) === requestId);
  const taskIds = tasks.map(t => String(t.id));
  const runs = taskIds.length === 0
    ? []
    : (await db.select().from(workerRunSchema).where(and(
        eq(workerRunSchema.orgId, orgId),
        sql`${workerRunSchema.input} -> 'record' ->> 'type' = 'engineering_task'`,
        inArray(sql<string>`${workerRunSchema.input} -> 'record' ->> 'id'`, taskIds),
      ))).map(r => ({ id: r.id, status: r.status, kind: r.kind, error: r.error, failures: (r.failures ?? []) as RunRow['failures'], input: (r.input ?? {}) as Meta, result: (r.result ?? null) as Meta | null, updatedAt: r.updatedAt, createdAt: r.createdAt, workerVersion: r.workerVersion ?? null })).sort((a, b) => b.id - a.id);
  const refs = new Set([`request:${requestId}`, ...taskIds.map(id => `engineering_task:${id}`)]);
  const openAsks = (await db.select({ id: askSchema.id, refs: askSchema.objectRefs }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'))))
    .filter(a => (a.refs ?? []).some(r => refs.has(`${r.type}:${r.id}`)))
    .map(a => a.id);
  const planIds = plans.map(p => String(p.id));
  const pending = await db.select({ actionId: actionRunSchema.actionId, input: actionRunSchema.input }).from(actionRunSchema).where(and(
    eq(actionRunSchema.orgId, orgId),
    inArray(actionRunSchema.actionId, [DISPATCH, APPROVE_PLAN]),
    // Only a card waiting on a person holds the factory back. An approved or
    // executing dispatch is this very chain in flight (a dispatch that went
    // to planning, whose plan is now being approved), not someone's move.
    eq(actionRunSchema.status, 'pending'),
  ));
  const waiting = pending.some((a) => {
    const i = (a.input ?? {}) as Meta;
    return a.actionId === DISPATCH
      ? Number(i.requestId) === requestId || taskIds.includes(String(i.taskId))
      : planIds.includes(String(i.planId));
  });
  return { tasks, runs, plans, openAsks, waiting };
}

/**
 * The request's newest approved plan, when it has one.
 * @param plans - Its plans.
 */
async function approvedPlan(plans: Row[]): Promise<Row | null> {
  const { planIsApproved } = await lib();
  return [...plans].filter(p => planIsApproved(p.meta)).sort((a, b) => b.id - a.id)[0] ?? null;
}

/**
 * The newest version a worker has reported on this workspace since a run was
 * claimed — what "the worker changed since" is measured against. Null when no
 * worker has said what it is.
 * @param orgId - Tenant.
 * @param run - The failed run.
 * @param run.id - Its id.
 */
async function newestWorkerVersion(orgId: string, run: { id: number }): Promise<string | null> {
  const { and, desc, eq, gt, isNotNull } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { workerRunSchema } = await import('@/models/Schema');
  const [row] = await db.select({ v: workerRunSchema.workerVersion }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), gt(workerRunSchema.id, run.id), isNotNull(workerRunSchema.workerVersion))).orderBy(desc(workerRunSchema.id)).limit(1);
  return row?.v ?? null;
}

/**
 * Whether the planning step the factory asked for has ended — every fire the
 * `factory.plan_requested` event started is finished — and what it said. Read
 * off the event the request raised and the fires it lists, so no automation
 * slug is known here. Null while one is still running, or when no such event
 * exists (the planning did not come from a request for a plan).
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param askedAt - When planning was asked for (`recovery.planRequestedAt`).
 */
async function planningEnded(orgId: string, requestId: number, askedAt: string): Promise<{ why: string } | null> {
  const { and, eq, gte, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema, eventLogSchema } = await import('@/models/Schema');
  const { FACTORY_PLAN_REQUESTED } = await import('@/services/EventService');
  const [event] = await db.select({ triggered: eventLogSchema.triggered }).from(eventLogSchema).where(and(eq(eventLogSchema.orgId, orgId), eq(eventLogSchema.dedupeKey, `${FACTORY_PLAN_REQUESTED}:${requestId}:${askedAt}`))).limit(1);
  if (!event) {
    return null;
  }
  const slugs = (event.triggered ?? []).map(t => t.slug.replace(/^automation:/, ''));
  if (slugs.length === 0) {
    return { why: 'nothing picked up the request for a plan' };
  }
  const fires = await db.select({ id: automationRunSchema.id, status: automationRunSchema.status, error: automationRunSchema.error }).from(automationRunSchema).where(and(
    eq(automationRunSchema.orgId, orgId),
    inArray(automationRunSchema.slug, slugs),
    gte(automationRunSchema.startedAt, new Date(Date.parse(askedAt) - 1000)),
    sql`${automationRunSchema.input} ->> 'requestId' = ${String(requestId)}`,
  ));
  if (fires.length === 0 || fires.some(f => f.status === 'running')) {
    return null;
  }
  const last = [...fires].sort((a, b) => b.id - a.id)[0]!;
  return { why: `the planning run (automation run #${last.id}) ended without filing a plan${last.error ? `: ${last.error.split('\n')[0]!.slice(0, 200).replace(/[.\s]+$/, '')}` : ''}` };
}

/**
 * Whether a request is open for the factory to act on at all.
 * @param request - The request.
 */
function isOpen(request: FactoryRecord): boolean {
  return request.typeSlug === 'request' && !CLOSED.has(String(request.meta.state ?? '')) && request.meta.recommendationState !== 'rejected';
}

/**
 * STOPPED: one ask to a person, with every attempt since the last person
 * action, its failure and what would unblock it. Filed once per count (the
 * source ref carries when the count began), so a re-run of the sweep
 * refreshes the same ask instead of filing another.
 *
 * A DECIDED ASK NEVER ABSORBS A NEW STOP (prod, 2026-09-29, ask #220): #124
 * stopped on the infrastructure, a person's approval of that ask never came —
 * a worker rebuild resolved it instead (`resumeAfterWorkerRebuild`), which
 * supersedes the ask but does not move `state.since` (a rebuild is not a
 * person's action, so the attempt count must not reset). The rebuilt build
 * then failed again, and this function's own sourceRef —
 * `factory-recovery:<id>:<since>` — was unchanged, so `upsertAsk`'s sourceRef
 * match found ask #220 again and refreshed that superseded row in place: no
 * open ask, nobody told, and the request read "stopped" against a dead ask
 * forever after (`recoverFailedRun` refuses to act again once `stage` is
 * `stopped`). So: before filing, read what already sits at this sourceRef
 * (`AskService.getAskBySourceRef`); a non-open row there is the last stop,
 * not this one, so this stop gets its own ask, disambiguated in the
 * sourceRef, and the two are put in one group
 * (`linkAskGroup`) so a person opening either sees both. If, after all that,
 * `upsertAsk` still hands back something that is not `open` — a bug in this
 * reasoning, not a case it predicted — that is an error on this run, not a
 * quiet return: an escalation that fails to put a question in front of a
 * person must never look like it succeeded.
 * @param orgId - Tenant.
 * @param request - The request.
 * @param why - What stopped it.
 * @param unblock - What would unblock it.
 * @param failure - The failure that stopped it, when a run failed: names what Approve does.
 */
async function escalate(orgId: string, request: FactoryRecord, why: string, unblock: string, failure: Failure | null = null): Promise<string> {
  const { getAskBySourceRef, linkAskGroup, upsertAsk } = await import('@/services/AskService');
  const state = readRecovery((await (await lib()).readRecord(orgId, request.id))?.meta ?? request.meta);
  const attempts = state.attempts.map(a => `${a.n}. ${a.kind === 'plan' ? 'Plan' : 'Build'}${a.runId ? ` (run #${a.runId})` : ''}: ${a.line}${a.failure ? ` — failed: ${a.failure.sentence}` : ''}`);
  const line = `${why.replace(/[.\s]+$/, '')}. What would unblock it: ${unblock}.`;
  const baseSourceRef = `factory-recovery:${request.id}:${state.since ?? 'start'}`;
  const prior = await getAskBySourceRef(orgId, baseSourceRef);
  const priorDecided = prior && prior.status !== 'open' ? prior : null;
  const now = new Date();
  const { ask } = await upsertAsk({
    orgId,
    createdBy: `agent:${PM}`,
    ask: {
      kind: 'approval',
      title: `Stopped: ${request.title}`.slice(0, 140),
      body: [
        priorDecided ? `This is a new stop: ask #${priorDecided.id} on this request was already decided (${priorDecided.status}) and does not answer this one.` : null,
        line,
        attempts.length > 0 ? `**What the factory tried since a person last acted**\n${attempts.join('\n')}` : 'The factory made no attempt of its own since a person last acted.',
        failure && INFRASTRUCTURE_FAILURES.has(failure.class)
          ? 'Approve to build again on the worker image deployed now (a note says what to change); reject to leave it stopped. A rebuilt worker resolves this on its own.'
          : 'Approve to build again (a note says what to change); reject to leave it stopped.',
      ].filter((p): p is string => p !== null).join('\n\n'),
      // A sourceRef a decided ask still holds is not this stop's slot — it
      // gets its own, disambiguated, so the unique (org, sourceRef) index
      // never forces this filing onto that old row.
      sourceRef: priorDecided ? `${baseSourceRef}:follow-up-${now.getTime()}` : baseSourceRef,
      groupKey: priorDecided ? (priorDecided.groupKey ?? `factory-recovery:${request.id}`) : undefined,
      agentSlug: PM,
      teamSlug: 'software-factory',
      risk: 'medium',
      // Approve names the action it takes, not "go ahead as proposed".
      options: stopOptions(request.id, failure),
      objectRefs: [{ type: 'request', id: String(request.id) }],
      decisionCost: 5,
      contextUrl: `/dashboard/p/feature/${request.id}`,
    },
  });
  // NEVER SILENT: a stop that could not put a question in front of a person
  // is not a stop that succeeded. `upsertAsk` should not be able to hand back
  // anything but `open` here — the check above already routed around the one
  // way it used to — but trusting that silently is exactly the bug this
  // fixes, so it is asserted, and a violation fails this run as `error`.
  if (ask.status !== 'open') {
    throw new Error(`escalation for request #${request.id} did not produce an open ask (ask #${ask.id} is ${ask.status})`);
  }
  if (priorDecided) {
    await linkAskGroup(orgId, priorDecided.id, priorDecided.groupKey ?? `factory-recovery:${request.id}`);
  }
  await updateRecovery(orgId, request.id, s => logLine({ ...s, stage: 'stopped', line, askId: ask.id }, `Stopped after ${s.attempts.length} attempt${s.attempts.length === 1 ? '' : 's'}: ${line} Ask #${ask.id} is with a person.`, now.toISOString()));
  return line;
}

/**
 * Whether the factory may take another automatic step on this request, and
 * when it may not, the stop filed as one ask. For callers outside this module
 * (QA's automatic Build again).
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param why - What the step would have been, for the ask.
 * @returns Null when another step is allowed; the stop's sentence when not.
 */
export async function stopIfAtLimit(orgId: string, requestId: number, why: string): Promise<string | null> {
  const { readRecord } = await lib();
  const request = await readRecord(orgId, requestId);
  if (!request) {
    return null;
  }
  const state = readRecovery(request.meta);
  if (state.attempts.length < state.limit) {
    return null;
  }
  return escalate(orgId, request, `Stopped after ${state.attempts.length} automatic attempts: ${why}`, 'read what QA asked for and press Build with a note on what to change');
}

/**
 * PLAN FIRST. Called by the dispatch when the plan gate says a plan is
 * required and none is approved: an open plan goes to its approval, an
 * approved one dispatches its build, and otherwise the planner is asked for
 * one (`factory.plan_requested`). The request reads "Planning — <why>".
 * @param orgId - Tenant.
 * @param opts - What the dispatch knew.
 * @param opts.request - The request.
 * @param opts.request.id
 * @param opts.request.title
 * @param opts.request.meta
 * @param opts.plan - The plan the dispatch named, if any.
 * @param opts.why - The rule's trigger sentences.
 * @param opts.counted - An automatic step (counts toward the limit); a person's press starts the count again.
 * @param opts.trigger - What started the dispatch.
 * @param opts.by - Who, for the log.
 * @param opts.at - When.
 */
export async function startPlanning(orgId: string, opts: { request: { id: number; title: string; meta: Meta }; plan: { id: number; meta: Meta } | null; why: string; counted: boolean; trigger: 'request' | 'recovery' | 'plan' | 'retry' | null; by: string; at: string }): Promise<{ planId: number | null; via: 'approval' | 'planner'; previous: unknown }> {
  const { noteAttempt } = await import('./recovery');
  const { planIsApproved } = await lib();
  const previous = opts.request.meta.recovery ?? null;
  const work = await workFor(orgId, opts.request.id);
  const open = opts.plan && !['rejected', 'superseded'].includes(String(opts.plan.meta.status ?? ''))
    ? opts.plan
    : [...work.plans].filter(p => !['rejected', 'superseded'].includes(String(p.meta.status ?? ''))).sort((a, b) => b.id - a.id)[0] ?? null;
  await updateRecovery(orgId, opts.request.id, (s) => {
    const base = opts.counted ? s : personActed(s, opts.at, `Build pressed by ${opts.by}.`);
    return opts.counted
      ? noteAttempt(base, { at: opts.at, kind: 'plan', trigger: opts.trigger ?? 'recovery', runId: null, taskId: null, line: opts.why })
      : logLine({ ...base, stage: 'planning', line: `Planning — ${opts.why}`, planRequestedAt: opts.at }, `Planning first: ${opts.why}`, opts.at);
  });
  if (open && planIsApproved(open.meta)) {
    await buildFromApprovedPlan(orgId, { planId: open.id, requestId: opts.request.id, approvedBy: String(open.meta.approvedBy ?? 'a person'), byPerson: false });
    return { planId: open.id, via: 'approval', previous };
  }
  if (open) {
    await reviewFiledPlan(orgId, { objectId: open.id, objectType: 'architecture_plan' });
    return { planId: open.id, via: 'approval', previous };
  }
  const { FACTORY_PLAN_REQUESTED, emitEvent } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: FACTORY_PLAN_REQUESTED,
    payload: { requestId: opts.request.id, title: opts.request.title, why: opts.why },
    dedupeKey: `${FACTORY_PLAN_REQUESTED}:${opts.request.id}:${opts.at}`,
    invokedBy: `agent:${PM}`,
    dispatchMode: 'auto',
  });
  return { planId: null, via: 'planner', previous };
}

/**
 * FILING STARTS THE WORK. A request was just created: a fix a person asked
 * for in a conversation starts its build within the trust bar
 * (`factory.dispatch_task.from_request`, Undo until a worker claims it);
 * anything else ready to build gets the Build card, filed here rather than by
 * the PM choosing to.
 * @param orgId - Tenant.
 * @param payload - The `object.created` payload.
 */
export async function intakeFiledRequest(orgId: string, payload: Partial<ObjectCreatedPayload>): Promise<CarryResult> {
  const { readRecord, writeMeta } = await lib();
  const id = Number(payload.objectId);
  if (payload.objectType !== 'request' || !Number.isInteger(id) || id <= 0) {
    return skip(null, 'not a request');
  }
  const request = await readRecord(orgId, id);
  if (!request || !isOpen(request)) {
    return skip(id, 'not an open request');
  }
  const work = await workFor(orgId, id);
  if (work.tasks.length > 0 || work.waiting) {
    return skip(id, 'work already exists for it');
  }
  const decision = intakeDecision({ meta: request.meta, origin: { conversationId: typeof payload.conversationId === 'number' ? payload.conversationId : null, byPerson: payload.byPerson === true } });
  if (decision.do === 'skip') {
    return skip(id, `left to triage: ${decision.why}`);
  }
  const plan = await approvedPlan(work.plans);
  const at = new Date().toISOString();
  if (decision.do === 'start') {
    const out = await propose(orgId, DISPATCH, { requestId: id, ...(plan ? { planId: plan.id } : {}), trigger: 'request', reason: `Started on its own: ${decision.why}.` }, {
      confidence: 0.9,
      rationale: `Filed from a person's turn in a conversation as a fix, with its acceptance written: ${decision.why}.`,
      reason: 'A person asked for this fix; the build starts now and Undo cancels it until a worker claims it.',
    });
    const line = !out.ok
      ? `Filed; the build could not start: ${out.error}`
      : out.res.status === 'pending' ? `Filed; the build is on a card for a person (action #${out.res.runId}): ${decision.why}.` : `Filed and started on its own: ${decision.why}.`;
    await updateRecovery(orgId, id, s => logLine(s, line, at));
    return { requestId: id, did: out.ok ? `start:${out.res.status}` : 'start:refused', line };
  }
  const out = await propose(orgId, DISPATCH, { requestId: id, ...(plan ? { planId: plan.id } : {}), reason: `Ready to build: ${decision.why}.` }, {
    confidence: 0.5,
    rationale: `The request carries its acceptance criteria; ${decision.why}.`,
    reason: 'Its acceptance is written, so it can be built as soon as a person says so.',
  });
  if (!out.ok) {
    return skip(id, `no card: ${out.error}`);
  }
  if (!request.meta.recommendationState) {
    await writeMeta(orgId, id, { recommendationState: 'proposed', recommendedAt: at, recommendedOutcome: 'build' });
  }
  const line = `Filed; the Build card is waiting on a person (action #${out.res.runId}).`;
  await updateRecovery(orgId, id, s => logLine(s, line, at));
  return { requestId: id, did: `card:${out.res.status}`, line };
}

/**
 * A plan was filed: when the factory asked for it, its approval goes on the
 * trust bar (`factory.approve_plan`). A plan that answers what a plan must,
 * for work a revert can undo, is approved with Undo; anything else is one
 * card with the recommendation.
 * @param orgId - Tenant.
 * @param payload - The `object.created` payload.
 */
export async function reviewFiledPlan(orgId: string, payload: Partial<ObjectCreatedPayload>): Promise<CarryResult> {
  const { planIsApproved, readRecord } = await lib();
  const planId = Number(payload.objectId);
  if (payload.objectType !== 'architecture_plan' || !Number.isInteger(planId)) {
    return skip(null, 'not a plan');
  }
  const plan = await readRecord(orgId, planId);
  const requestId = Number(plan?.meta.requestId);
  const request = Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
  if (!plan || !request || !isOpen(request)) {
    return skip(Number.isInteger(requestId) ? requestId : null, 'no open request for this plan');
  }
  if (readRecovery(request.meta).stage !== 'planning') {
    return skip(requestId, 'the factory did not ask for this plan');
  }
  if (planIsApproved(plan.meta)) {
    return buildFromApprovedPlan(orgId, { planId, requestId, approvedBy: String(plan.meta.approvedBy ?? 'a person'), byPerson: false });
  }
  const { planConfidence } = await import('@/libs/actions/factory-approve-plan');
  const { confidence, gaps } = planConfidence(plan.meta);
  const content = gaps.filter(g => !g.startsWith('the rule named'));
  const out = await propose(orgId, APPROVE_PLAN, { planId, reason: `Plan #${planId} is written for request #${requestId}.` }, {
    confidence,
    rationale: gaps.length === 0 ? 'The plan states its approach, what changes, what was rejected, how it is verified and what happens to existing data.' : `The plan is missing: ${gaps.join('; ')}.`,
    reason: content.length === 0 ? (gaps.length === 0 ? 'The plan answers everything a plan must.' : 'The plan is complete, and the work is a kind a revert cannot undo, so a person approves it.') : `Send it back: ${content.join('; ')}.`,
    decision: content.length === 0 ? 'approve' : 'reject',
  });
  const at = new Date().toISOString();
  const line = !out.ok
    ? `Plan #${planId} written; its approval could not be filed: ${out.error}`
    : out.res.status === 'pending' ? `Plan #${planId} written; a person approves it (action #${out.res.runId})${content.length ? ` — missing ${content.join('; ')}` : ''}.` : `Plan #${planId} written and approved within the trust bar; Undo puts it back in review.`;
  await updateRecovery(orgId, requestId, s => logLine(s.stage === 'planning' ? { ...s, line: out.ok && out.res.status === 'pending' ? `Planning — plan #${planId} is written and waiting for approval.` : s.line } : s, line, at));
  return { requestId, did: out.ok ? `approve_plan:${out.res.status}` : 'approve_plan:refused', line };
}

/**
 * A plan was approved: the build it was written for dispatches itself with
 * the plan's id, and the contract takes its paths from the plan's
 * components. A person's approval starts the count again.
 * @param orgId - Tenant.
 * @param payload - The `plan.approved` payload.
 * @param payload.planId
 * @param payload.requestId
 * @param payload.approvedBy
 * @param payload.byPerson
 */
export async function buildFromApprovedPlan(orgId: string, payload: { planId?: unknown; requestId?: unknown; approvedBy?: unknown; byPerson?: unknown }): Promise<CarryResult> {
  const { readRecord } = await lib();
  const planId = Number(payload.planId);
  const plan = Number.isInteger(planId) && planId > 0 ? await readRecord(orgId, planId) : null;
  const requestId = Number(payload.requestId ?? plan?.meta.requestId);
  const request = Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
  if (!plan || !request || !isOpen(request)) {
    return skip(Number.isInteger(requestId) ? requestId : null, 'no open request for this plan');
  }
  const work = await workFor(orgId, requestId);
  if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting) {
    return skip(requestId, 'a build is already running or waiting');
  }
  const at = new Date().toISOString();
  const by = String(payload.approvedBy ?? 'a person');
  if (payload.byPerson === true) {
    await updateRecovery(orgId, requestId, s => personActed(s, at, `${by} approved plan #${planId}.`));
  }
  const state = readRecovery((await readRecord(orgId, requestId))?.meta);
  if (state.attempts.length >= state.limit) {
    const line = await escalate(orgId, request, `Stopped after ${state.attempts.length} attempts: the plan is approved, and the limit on automatic attempts is reached`, 'press Build to start it');
    return { requestId, did: 'escalate', line };
  }
  const out = await propose(orgId, DISPATCH, { requestId, planId, trigger: 'plan', reason: `Plan #${planId} approved by ${by}; the build starts with its paths.` }, {
    confidence: 0.95,
    rationale: `The plan the rule required is approved (${by}); the contract takes its paths from the plan's components.`,
    reason: 'The plan is approved; nothing else stands between it and the build.',
  });
  const line = !out.ok ? `Plan #${planId} approved; the build could not start: ${out.error}` : out.res.status === 'pending' ? `Plan #${planId} approved; the build is on a card for a person (action #${out.res.runId}).` : `Plan #${planId} approved; the build started on its own.`;
  await updateRecovery(orgId, requestId, s => logLine(s, line, at));
  if (!out.ok) {
    await escalate(orgId, request, `The plan is approved but the build could not start: ${out.error}`, 'fix what the dispatch refused on, then press Build');
  }
  return { requestId, did: out.ok ? `build:${out.res.status}` : 'build:refused', line };
}

/**
 * A FAILED RUN RECOVERS. Classify the failure, then, within the limit: plan
 * first, send it again with what the checks said, send it again once after
 * the infrastructure failed, send it again only if the contract changed — or
 * stop and ask a person once, with every attempt and what would unblock it.
 * @param orgId - Tenant.
 * @param runId - The failed run.
 * @param opts - Options.
 * @param opts.now - The clock.
 */
export async function recoverFailedRun(orgId: string, runId: number, opts: { now?: Date } = {}): Promise<CarryResult> {
  const { previewContract, readRecord } = await lib();
  const { getWorkerRun, runRecord } = await import('@/services/WorkerRunService');
  const now = opts.now ?? new Date();
  const run = await getWorkerRun(orgId, runId);
  if (!run || !['failed', 'lost'].includes(run.status)) {
    return skip(null, 'not a failed run');
  }
  const rec = runRecord(run);
  // An engineering task is code; a run for anything else is an agent's prompt, not this loop's.
  if (run.kind !== 'worker' || rec?.type !== 'engineering_task') {
    return skip(null, 'not an engineering run');
  }
  if (run.status === 'lost' && now.getTime() - run.updatedAt.getTime() < LOST_GRACE_MS) {
    return skip(null, 'lost too recently; its worker may still re-claim it');
  }
  const task = await readRecord(orgId, rec.id);
  const requestId = Number(task?.meta.requestId);
  const request = task && Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
  if (!task || !request || !isOpen(request)) {
    return skip(Number.isInteger(requestId) ? requestId : null, 'no open request for this run');
  }
  const state = readRecovery(request.meta);
  if (state.handledRunIds.includes(run.id)) {
    return skip(requestId, 'already handled');
  }
  if (state.stage === 'stopped') {
    return skip(requestId, 'stopped; a person decides next');
  }
  const work = await workFor(orgId, requestId);
  if (work.runs[0] && work.runs[0].id !== run.id) {
    return skip(requestId, `run #${work.runs[0].id} is newer`);
  }
  if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting) {
    return skip(requestId, 'another attempt is already running or waiting');
  }
  if (work.openAsks.length > 0) {
    return skip(requestId, `ask #${work.openAsks[0]} is open on it`);
  }
  const failure: Failure = classifyFailure({ status: run.status, error: run.error, failures: run.failures as Array<{ scope?: string; message?: string }> });
  const planId = Number(task.meta.planId) > 0 ? Number(task.meta.planId) : (await approvedPlan(work.plans))?.id;
  const base = { requestId, ...(planId ? { planId } : {}) };
  let delta: string[] = [];
  if (failure.class === 'no_changes') {
    const before = ((run.input ?? {}) as { task?: Meta }).task ?? {};
    const after = await previewContract(orgId, base);
    delta = after ? contractDelta(before, after) : [];
  }
  let envDelta: string[] = [];
  if (failure.class === 'environment') {
    const before = ((run.input ?? {}) as { task?: Meta }).task ?? {};
    const after = await previewContract(orgId, base);
    envDelta = environmentDelta(
      { workerVersion: run.workerVersion ?? null, environment: before.environment ?? null },
      { workerVersion: await newestWorkerVersion(orgId, run), environment: after?.environment ?? null },
    );
  }
  const decision = recoveryDecision({ failure, attempts: state.attempts.length, limit: state.limit, contractDelta: delta, environmentDelta: envDelta, lastWasInfraRetry: ['lost', 'transient'].includes(String(task.meta.recoveryClass ?? '')) });
  // Handled first, so the event and the sweep never both act on this run.
  await updateRecovery(orgId, requestId, s => markHandled(s, run.id, failure));
  let line: string;
  if (decision.do === 'escalate') {
    line = await escalate(orgId, request, decision.why, decision.unblock, failure);
  } else {
    const input = {
      ...base,
      trigger: 'recovery',
      recoveryOfRun: run.id,
      recoveryClass: failure.class,
      ...(decision.do === 'plan' ? { planFirst: decision.why } : {}),
      ...(decision.do === 'dispatch' && decision.note ? { note: decision.note } : {}),
      reason: decision.do === 'plan' ? `Recovered: planning first because ${decision.why}.` : `Recovered: sending it again because ${decision.why}.`,
    };
    const out = await propose(orgId, DISPATCH, input, {
      confidence: 0.9,
      rationale: `Run #${run.id} failed: ${failure.sentence}. ${decision.do === 'plan' ? 'The worker refused the contract for want of a plan.' : 'The failure is one the next attempt can answer.'}`,
      reason: 'One automatic attempt within the limit; Undo cancels it until a worker claims it.',
    });
    if (!out.ok) {
      line = await escalate(orgId, request, `Stopped: the recovery for run #${run.id} could not start — ${out.error}`, unblockFor(failure), failure);
    } else if (out.res.status === 'pending') {
      line = `${input.reason} It is on a card for a person (action #${out.res.runId}).`;
      await updateRecovery(orgId, requestId, s => logLine(s, line, now.toISOString(), run.id));
    } else {
      // The dispatch wrote the attempt (and its line) itself.
      line = input.reason;
    }
  }
  await recordRunLine(orgId, run.id, line);
  return { requestId, did: decision.do, line };
}

/**
 * The person answered the stop. Whatever they chose, the count starts again;
 * approve builds again as them, carrying their note.
 * @param orgId - Tenant.
 * @param payload - The `ask.decided` payload.
 */
export async function answerRecoveryAsk(orgId: string, payload: Partial<AskDecidedPayload>): Promise<CarryResult> {
  const m = /^factory-recovery:(\d+):/.exec(String(payload.sourceRef ?? ''));
  if (!m) {
    return skip(null, 'not a recovery ask');
  }
  const requestId = Number(m[1]);
  const { readRecord } = await lib();
  const request = await readRecord(orgId, requestId);
  if (!request) {
    return skip(requestId, 'no request');
  }
  const by = String(payload.decidedBy ?? 'a person');
  const at = new Date().toISOString();
  const approved = payload.status === 'approved' || payload.decision === 'approve';
  await updateRecovery(orgId, requestId, s => personActed(s, at, `${by} answered the stop: ${approved ? 'build again' : 'leave it stopped'}.`));
  if (!approved) {
    return { requestId, did: 'left stopped', line: null };
  }
  const { getAsk } = await import('@/services/AskService');
  const ask = payload.askId ? await getAsk(orgId, Number(payload.askId)) : null;
  const work = await workFor(orgId, requestId);
  const plan = await approvedPlan(work.plans);
  const out = await propose(orgId, DISPATCH, { requestId, ...(plan ? { planId: plan.id } : {}), ...(ask?.decisionNote?.trim() ? { note: ask.decisionNote.trim() } : {}), reason: `Build again, as ${by} answered the stop.` }, { confidence: 0.5, rationale: `${by} approved building again.`, reason: 'A person said build again.' });
  if (!out.ok) {
    return { requestId, did: 'refused', line: out.error };
  }
  if (out.res.status === 'pending') {
    const { executeAction } = await import('@/services/ActionService');
    await executeAction(out.res.runId, orgId, { reviewedBy: by });
  }
  return { requestId, did: 'build again', line: `Build again, as ${by} answered the stop.` };
}

/**
 * A planning step ended without a plan: the attempt it was is marked failed,
 * and within the limit planning is asked for again; at the limit, one ask.
 * @param orgId - Tenant.
 * @param request - The request.
 * @param state - Its recovery state.
 * @param why - What the planning run did.
 * @param now - The clock.
 */
async function replan(orgId: string, request: FactoryRecord, state: RecoveryState, why: string, now: Date): Promise<CarryResult> {
  const planWhy = (state.line ?? '').replace(/^Planning\s*—\s*/, '') || 'the plan rule requires a plan';
  const failure: Failure = { class: 'no_plan', sentence: why, tail: null, failedChecks: [] };
  await updateRecovery(orgId, request.id, (s) => {
    const last = [...s.attempts].reverse().find(a => a.kind === 'plan' && !a.failure);
    const attempts = s.attempts.map(a => (a === last ? { ...a, failure: { class: failure.class, sentence: why } } : a));
    // Counted: an uncounted planning step (a person's press) becomes one now,
    // so a planner that never files can never loop.
    const counted = last ? attempts : [...attempts, { n: attempts.length + 1, at: s.planRequestedAt ?? now.toISOString(), kind: 'plan' as const, trigger: 'recovery' as const, runId: null, taskId: null, line: planWhy, failure: { class: failure.class, sentence: why } }];
    return logLine({ ...s, attempts: counted }, `Planning failed: ${why}.`, now.toISOString());
  });
  const fresh = readRecovery((await (await lib()).readRecord(orgId, request.id))?.meta);
  const decision = recoveryDecision({ failure, attempts: fresh.attempts.length, limit: fresh.limit, planWhy });
  if (decision.do !== 'plan') {
    return { requestId: request.id, did: 'escalate', line: await escalate(orgId, request, decision.why, 'write the plan, or say the work does not need one, then press Build') };
  }
  const { noteAttempt } = await import('./recovery');
  const at = now.toISOString();
  await updateRecovery(orgId, request.id, s => noteAttempt(s, { at, kind: 'plan', trigger: 'recovery', runId: null, taskId: null, line: planWhy }));
  const { FACTORY_PLAN_REQUESTED, emitEvent } = await import('@/services/EventService');
  await emitEvent({ orgId, type: FACTORY_PLAN_REQUESTED, payload: { requestId: request.id, title: request.title, why: planWhy }, dedupeKey: `${FACTORY_PLAN_REQUESTED}:${request.id}:${at}`, invokedBy: `factory:${PM}`, dispatchMode: 'auto' });
  return { requestId: request.id, did: 'plan', line: `Recovered: planning again because ${why}.` };
}

/**
 * A REBUILT WORKER ANSWERS AN INFRASTRUCTURE STOP. Ask #220 (2026-09-28):
 * "Stopped: Open alerts — the infrastructure failed twice", filed at 19:09;
 * the worker image was rebuilt at 21:06 (the deploy's record-environment step
 * moved `squatch-worker-production`'s lastDeployedAt), and the ask sat open
 * asking a person to press Build for a failure that no longer existed.
 *
 * So, for every open stop whose request's newest run failed on the
 * infrastructure (`INFRASTRUCTURE_FAILURES`), a worker seen after the stop —
 * a worker environment record deployed since, or a run that reported a
 * different worker version (`workerRebuiltSince`) — resolves it: the ask is
 * superseded with "Worker rebuilt (<version>); building again", and the build
 * is dispatched once, keyed on the failed run (the dispatch's own dedup) and
 * on the version (`meta.workerRebuildResumedFor`), on the recovery trust rule.
 * @param orgId - Tenant.
 * @param now - The clock.
 */
export async function resumeAfterWorkerRebuild(orgId: string, now: Date = new Date()): Promise<CarryResult[]> {
  const { and, desc, eq, gt, isNotNull, like } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema, workerRunSchema } = await import('@/models/Schema');
  const stops = await db.select({ id: askSchema.id, sourceRef: askSchema.sourceRef, createdAt: askSchema.createdAt }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, 'factory-recovery:%')));
  if (stops.length === 0) {
    return [];
  }
  const oldest = new Date(Math.min(...stops.map(a => (a.createdAt ?? now).getTime())));
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const environments = ((await listBusinessObjects(orgId, 'environment').catch(() => [])) as Array<{ title: string; metadata: unknown }>)
    .map(r => (r.metadata ?? {}) as Meta)
    .filter(m => m.surface === 'worker' || /worker/i.test(String(m.slug ?? '')))
    .map(m => ({ slug: String(m.slug ?? 'worker'), lastDeployedAt: typeof m.lastDeployedAt === 'string' ? m.lastDeployedAt : null, lastDeployedSha: typeof m.lastDeployedSha === 'string' ? m.lastDeployedSha : null }));
  const reported = (await db.select({ v: workerRunSchema.workerVersion, at: workerRunSchema.claimedAt }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), isNotNull(workerRunSchema.workerVersion), gt(workerRunSchema.claimedAt, oldest))).orderBy(desc(workerRunSchema.id)).limit(20))
    .flatMap(r => (r.v && r.at ? [{ version: r.v, at: r.at }] : []));
  const { readRecord, writeMeta } = await lib();
  const { supersedeAsk } = await import('@/services/AskService');
  const out: CarryResult[] = [];
  for (const stop of stops) {
    const requestId = Number(/^factory-recovery:(\d+):/.exec(String(stop.sourceRef ?? ''))?.[1]);
    const request = Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
    if (!request || !isOpen(request)) {
      continue;
    }
    const work = await workFor(orgId, requestId);
    const failed = work.runs[0];
    if (!failed || !['failed', 'lost'].includes(failed.status) || work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting) {
      continue;
    }
    const failure = classifyFailure({ status: failed.status, error: failed.error, failures: failed.failures });
    if (!INFRASTRUCTURE_FAILURES.has(failure.class)) {
      continue;
    }
    const rebuilt = workerRebuiltSince({ stoppedAt: stop.createdAt ?? now, failedVersion: failed.workerVersion ?? null, environments, reported });
    if (!rebuilt || request.meta.workerRebuildResumedFor === rebuilt.version) {
      continue;
    }
    const line = `Worker rebuilt (${rebuilt.version}); building again.`;
    const task = work.tasks.find(t => String(t.id) === String((failed.input.record as Meta | undefined)?.id));
    const planId = Number(task?.meta.planId) > 0 ? Number(task!.meta.planId) : (await approvedPlan(work.plans))?.id;
    const dispatched = await propose(orgId, DISPATCH, { requestId, ...(planId ? { planId } : {}), trigger: 'recovery', recoveryOfRun: failed.id, recoveryClass: failure.class, reason: line }, {
      confidence: 0.9,
      rationale: `Run #${failed.id} failed on the infrastructure (${failure.sentence}); the worker was rebuilt after the stop (${rebuilt.version}, ${rebuilt.source === 'environment' ? 'its environment record' : 'a run reported it'}).`,
      reason: 'The failure was the worker, and there is a new worker; Undo cancels it until a worker claims it.',
    });
    const at = now.toISOString();
    if (!dispatched.ok) {
      // The stop stays open, and says why the rebuild did not carry it on.
      await updateRecovery(orgId, requestId, s => logLine(s, `Worker rebuilt (${rebuilt.version}), but the build could not start: ${dispatched.error}`, at));
      out.push({ requestId, did: 'rebuilt:refused', line: dispatched.error });
      continue;
    }
    await writeMeta(orgId, requestId, { workerRebuildResumedFor: rebuilt.version });
    await supersedeAsk(orgId, stop.id, line);
    await updateRecovery(orgId, requestId, s => logLine({ ...s, stage: s.stage === 'stopped' ? null : s.stage, askId: s.askId === stop.id ? null : s.askId, line: s.stage === 'stopped' ? null : s.line }, `${line} Ask #${stop.id} resolved itself.${dispatched.res.status === 'pending' ? ` The build is on a card for a person (action #${dispatched.res.runId}).` : ''}`, at, failed.id));
    await recordRunLine(orgId, failed.id, line);
    out.push({ requestId, did: `rebuilt:${dispatched.res.status}`, line });
  }
  return out;
}

/**
 * EXISTING STUCK REQUESTS. The same recovery for a request whose newest
 * engineering run failed (in the last fourteen days), that has no run going,
 * no ask open and is not deferred or rejected — so a request already stuck
 * when this ships continues without anyone pressing Build. Also notices a plan that was
 * approved while nothing dispatched, and one that was asked for and never
 * written.
 * @param orgId - Tenant.
 * @param now - The clock.
 * @param limit - The most requests acted on in one sweep.
 */
export async function sweepStuckRequests(orgId: string, now: Date = new Date(), limit = 10): Promise<{ acted: CarryResult[] }> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const { readRecord } = await lib();
  const requests = ((await listBusinessObjects(orgId, 'request').catch(() => [])) as Array<{ id: number }>).map(r => r.id).sort((a, b) => a - b);
  // A stop the worker's rebuild answered resolves first, so the requests it
  // carried on are not read as stuck below.
  const acted: CarryResult[] = await resumeAfterWorkerRebuild(orgId, now).catch((err: Error) => {
    console.warn('factory sweep: the worker-rebuild check failed', { orgId, message: err.message });
    return [];
  });
  for (const id of requests) {
    if (acted.length >= limit) {
      break;
    }
    const request = await readRecord(orgId, id);
    if (!request || !isOpen(request)) {
      continue;
    }
    const state = readRecovery(request.meta);
    const work = await workFor(orgId, id);
    if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting || work.openAsks.length > 0) {
      continue;
    }
    if (state.stage === 'planning') {
      const plan = await approvedPlan(work.plans);
      if (plan) {
        acted.push(await buildFromApprovedPlan(orgId, { planId: plan.id, requestId: id, approvedBy: String(plan.meta.approvedBy ?? 'a person'), byPerson: false }));
        continue;
      }
      const asked = state.planRequestedAt ? Date.parse(state.planRequestedAt) : Number.NaN;
      // A PLANNING RUN THAT ENDED WITHOUT A PLAN IS A FAILED STEP, not
      // "already planning" (#201, mission 6017: it read the request and
      // proposed an approval for a plan it never filed). It counts toward the
      // limit: plan again, or stop and ask.
      const filedSince = work.plans.some(p => !['rejected', 'superseded'].includes(String(p.meta.status ?? '')) && (p.createdAt?.getTime() ?? 0) >= asked - 1000);
      const ended = !filedSince && state.planRequestedAt ? await planningEnded(orgId, id, state.planRequestedAt) : null;
      if (ended) {
        acted.push(await replan(orgId, request, state, ended.why, now));
        continue;
      }
      if (work.plans.length === 0 && Number.isFinite(asked) && now.getTime() - asked > PLAN_STALE_MS) {
        acted.push({ requestId: id, did: 'escalate', line: await escalate(orgId, request, 'Stopped: a plan was asked for a day ago and none was written', 'write the plan, or say the work does not need one') });
      }
      continue;
    }
    const newest = work.runs[0];
    if (newest && ['failed', 'lost'].includes(newest.status) && !state.handledRunIds.includes(newest.id) && state.stage !== 'stopped' && now.getTime() - newest.updatedAt.getTime() < SWEEP_WINDOW_MS) {
      const r = await recoverFailedRun(orgId, newest.id, { now });
      if (r.line) {
        acted.push(r);
      }
    }
  }
  return { acted };
}
