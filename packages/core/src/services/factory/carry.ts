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

import type { BlockerFacts } from './blocker';
import type { Failure, RecoveryState } from './recovery';
import type { BuildReadiness, FactoryRecord } from '@/libs/actions/factory-dispatch';
import type { ProposeResult } from '@/services/ActionService';
import type { AskDecidedPayload, ObjectCreatedPayload } from '@/services/EventService';
import { nounCode } from '@/libs/codes';
import { settledReason } from '@/libs/factory/requestStates';
import { factoryTypes } from '@/libs/factory/types';
import { codeForRecord } from '@/services/codes';
import { markStatus } from '@/services/objects/statusField';
import { blockerRefs, blockerResolution } from './blocker';
import { attemptsOf, classifyFailure, contractDelta, environmentDelta, INFRASTRUCTURE_FAILURES, intakeDecision, logLine, markHandled, personActed, readRecovery, recoveryDecision, replanBrief, settledForMergeCard, staleFailure, stalePlanRoots, stopOptions, unblockFor, workerRebuiltSince } from './recovery';

/** The seat whose judgement the factory's own proposals represent. */
const PM = 'product-manager';
const DISPATCH = 'factory.dispatch_task';
const APPROVE_PLAN = 'factory.approve_plan';
const LIVE_RUN = new Set(['queued', 'running', 'paused', 'awaiting_review']);
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
/** Planning that has filed nothing this long after it was asked for has ended without a plan. */
const PLAN_QUIET_MS = 45 * 60_000;

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
      // The factory's own step: its triggers and counters are kept.
      internal: true,
      proposal: { confidence: env.confidence, rationale: env.rationale, agentSlug: PM, suggestedDecision: env.decision ?? 'approve', suggestedDecisionReason: env.reason },
    });
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * The same proposal, as the person: their own action, so it runs with Undo
 * and puts no card in front of them. Only for a step the person told the
 * factory to take in their own words (`personSaidTo`).
 * @param orgId - Tenant.
 * @param userId - The person whose word it is.
 * @param conversationId - Where they said it.
 * @param actionId - The action.
 * @param input - Its input.
 * @param env - The envelope, as `propose` takes it.
 * @param env.confidence - How sure the factory is.
 * @param env.rationale - Why the payload is right.
 * @param env.reason - Why it should be approved.
 */
async function proposeAsPerson(orgId: string, userId: string, conversationId: number | null, actionId: string, input: Meta, env: { confidence: number; rationale: string; reason: string }): Promise<{ ok: true; res: ProposeResult } | { ok: false; error: string }> {
  try {
    const { proposeAction } = await import('@/services/ActionService');
    const res = await proposeAction({
      orgId,
      actionId,
      input,
      principal: { kind: 'user', id: userId, role: 'member', scope: { orgId } },
      invokedBy: userId,
      ...(conversationId !== null ? { origin: { conversationId, userId, byPerson: true } } : {}),
      proposal: { confidence: env.confidence, rationale: env.rationale, agentSlug: PM, suggestedDecision: 'approve', suggestedDecisionReason: env.reason },
    });
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Whether the person who filed this in a conversation told the factory, in
 * their own words, to take this step, read by a model (`saidToDecide`),
 * never matched. Conversation 398 (2026-09-30): "Please file it and build it."
 * filed #277 and then put its Build card in front of the same person.
 * @param orgId - Tenant.
 * @param conversationId - The conversation the record was filed from.
 * @param decision - The step, in words the read can check their message against.
 */
async function personSaidTo(orgId: string, conversationId: number, decision: string): Promise<{ userId: string; quote: string | null } | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { conversationSchema } = await import('@/models/Schema');
  const [conversation] = await db.select({ createdBy: conversationSchema.createdBy }).from(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId))).limit(1);
  const userId = conversation?.createdBy?.trim();
  const { decidedByMachine } = await import('@/libs/actions/decider');
  if (!userId || decidedByMachine(userId)) {
    return null;
  }
  const { personMessages } = await import('@/services/agents/owedDecision');
  const { saidToDecide } = await import('@/services/agents/turnJudge');
  const said = await saidToDecide({ orgId, messages: await personMessages({ orgId, conversationId }), decision });
  return said.said ? { userId, quote: said.quote } : null;
}

/**
 * The person who asked for a record: the one whose conversation it was filed
 * from, else the actor when that is a person. Null when a machine filed it.
 * @param orgId - Tenant.
 * @param conversationId - The filing conversation, when there was one.
 * @param actor - The event's actor.
 */
async function filingPerson(orgId: string, conversationId: number | null, actor: unknown): Promise<string | null> {
  const { decidedByMachine } = await import('@/libs/actions/decider');
  if (conversationId !== null) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { conversationSchema } = await import('@/models/Schema');
    const [conversation] = await db.select({ createdBy: conversationSchema.createdBy }).from(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId))).limit(1);
    const createdBy = conversation?.createdBy?.trim();
    if (createdBy && !decidedByMachine(createdBy)) {
      return createdBy;
    }
  }
  const who = typeof actor === 'string' ? actor.trim() : '';
  return who && who !== 'system' && !who.includes(':') && !decidedByMachine(who) ? who : null;
}

/**
 * An attempt passed QA and its merge card is filed: the request is not
 * recovering or planning any more, so its stage settles on one true line —
 * "QA approved 8 of 8; the merge waits on a person (infra class)." Read fresh
 * and written only when there was a stage to settle.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param line - The line (`mergeCardLine`).
 * @param cardAt - When the card was filed.
 * @param at - When this is written.
 * @param waitsOnPerson - The card is pending: a person merges (else it merges on its trust rule).
 * @returns Whether it settled a stage or moved the request's status.
 */
export async function settleOnMergeCard(orgId: string, requestId: number, line: string, cardAt: string, at: string, waitsOnPerson = true): Promise<boolean> {
  const { readRecord, writeMeta } = await lib();
  const request = await readRecord(orgId, requestId);
  if (!request) {
    return false;
  }
  // The status says whose move it is (FE-130 read "Awaiting dispatch" over
  // QA 8 of 8 and a merge card waiting on a person).
  const marked = await markStatus(orgId, requestId, waitsOnPerson ? 'merge_waits' : 'merge_running', { line, at });
  const next = settledForMergeCard(readRecovery(request.meta), line, cardAt, at);
  if (next) {
    await writeMeta(orgId, requestId, { recovery: next });
  }
  return next !== null || marked !== null;
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
  const before = readRecovery(request.meta);
  const next = change(before);
  await writeMeta(orgId, requestId, { recovery: next });
  // A STOP IS THE REQUEST'S STATUS (`x-transitions: stopped`), from whichever
  // step stopped it: a limit reached, a pipeline owner's fix, a check command.
  if (next.stage === 'stopped' && before.stage !== 'stopped') {
    await markStatus(orgId, requestId, 'stopped', { line: next.line });
  }
  return next;
}

/**
 * One line on a request's own account (its Activity), from a step outside
 * this file — a red CI's routing (`ciFailed.ts`), the pipeline reconciler.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param line - What happened, in a sentence.
 * @param runId - The run it was about, when there is one.
 */
export async function noteOnRequest(orgId: string, requestId: number, line: string, runId: number | null = null): Promise<void> {
  await updateRecovery(orgId, requestId, s => logLine(s, line, new Date().toISOString(), runId));
}

/**
 * THE MERGE SETTLES THE FACTORY'S CARRYING (#269, 2026-09-30: merged at 22:38,
 * the request still read "Recovering (attempt 2 of 3): QA sent attempt #271
 * back…" — a line from the morning). Once the change has merged there is no
 * attempt out and nothing to recover: the stage and its line clear, and the
 * request's own account says what happened (`services/factory/delivery.ts`).
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param line - What happened, in a sentence.
 */
export async function settleOnMerge(orgId: string, requestId: number, line: string): Promise<void> {
  await settleOnRequest(orgId, requestId, line);
}

/**
 * The factory stops carrying a request, and its account says why: the stage
 * and its line clear, one line is logged.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param line - What happened, in a sentence.
 */
export async function settleOnRequest(orgId: string, requestId: number, line: string): Promise<void> {
  await updateRecovery(orgId, requestId, s => ({ ...logLine(s, line, new Date().toISOString(), null), stage: null, line: null }));
}

/**
 * A step outside this file stopped on a request and put its one ask in front
 * of a person (the pipeline's owner, `pipelineChange.ts`): the request reads
 * Stopped with that ask, the way `escalate` leaves it, so the feature page's
 * You line says "Needs you" and a person's answer clears it.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param line - Why, and what would unblock it.
 * @param askId - The ask that is with a person.
 */
export async function stopOnRequest(orgId: string, requestId: number, line: string, askId: number): Promise<void> {
  const at = new Date().toISOString();
  await updateRecovery(orgId, requestId, s => logLine({ ...s, stage: 'stopped', line, askId }, line, at));
}

/**
 * A BLOCKER WHOSE MOVE WAS MADE IS CLEARED (#130, 2026-09-29): "approve plan
 * 136" stayed on the request as Blocked after plan 136 was approved, because
 * nothing read the blocker back when the state it named moved. The records it
 * waits on (`blocker.ts`) are read here; when one has been decided the blocker
 * is removed and the request's Activity says why, with the date.
 * @param orgId - Tenant.
 * @param request - The request.
 * @param request.id - Its id.
 * @param request.meta - Its metadata, blocker included.
 * @param plans - Its plans, when the caller already has them.
 * @param now - The clock.
 */
export async function clearResolvedBlocker(orgId: string, request: { id: number; meta: Meta }, plans?: Row[], now: Date = new Date()): Promise<string | null> {
  const raw = request.meta.blocker;
  const refs = blockerRefs(raw);
  if (refs.length === 0) {
    return null;
  }
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, askSchema } = await import('@/models/Schema');
  const idsOf = (kind: string) => refs.filter(r => r.kind === kind).map(r => r.id);
  const planRows = plans ?? (await workFor(orgId, request.id)).plans;
  const { readRecord } = await lib();
  // A plan it names may belong to another request; read it by id when it is not one of this request's.
  const namedPlans = await Promise.all(idsOf('plan').map(async id => planRows.find(p => p.id === id) ?? await readRecord(orgId, id)));
  const askIds = idsOf('ask');
  const actionIds = idsOf('action');
  const facts: BlockerFacts = {
    plans: namedPlans.filter((p): p is NonNullable<typeof p> => Boolean(p)).map(p => ({ id: p.id, status: p.meta.status, approvedAt: p.meta.approvedAt })),
    asks: askIds.length === 0 ? [] : await db.select({ id: askSchema.id, status: askSchema.status, decidedAt: askSchema.decidedAt }).from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, askIds))),
    actions: actionIds.length === 0 ? [] : await db.select({ id: actionRunSchema.id, status: actionRunSchema.status, decidedAt: actionRunSchema.decidedAt, executedAt: actionRunSchema.executedAt }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, actionIds))),
  };
  const resolved = blockerResolution(raw, facts);
  if (!resolved) {
    return null;
  }
  const { writeMeta } = await lib();
  const what = String((raw as Meta).what ?? 'the blocker');
  const when = (resolved.at ?? now).toISOString();
  const line = `Cleared the blocker, because ${resolved.line}${resolved.at ? ` (${when.slice(0, 16).replace('T', ' ')} UTC)` : ''}: ${what}`;
  await writeMeta(orgId, request.id, { blocker: null });
  await updateRecovery(orgId, request.id, s => logLine(s, line, now.toISOString()));
  return line;
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
  const { planClosed } = await lib();
  const toRow = (r: { id: number; title: string; status: string | null; metadata: unknown; createdAt: Date | null }): Row => ({ id: r.id, title: r.title, status: r.status, meta: (r.metadata ?? {}) as Meta, createdAt: r.createdAt });
  const types = await factoryTypes(orgId);
  const tasks = ((await listBusinessObjects(orgId, types.task).catch(() => [])) as Array<Parameters<typeof toRow>[0]>).map(toRow).filter(t => Number(t.meta.requestId) === requestId);
  const plans = ((await listBusinessObjects(orgId, types.plan).catch(() => [])) as Array<Parameters<typeof toRow>[0]>).map(toRow).filter(p => Number(p.meta.requestId) === requestId);
  const taskIds = tasks.map(t => String(t.id));
  const runs = taskIds.length === 0
    ? []
    : (await db.select().from(workerRunSchema).where(and(
        eq(workerRunSchema.orgId, orgId),
        sql`${workerRunSchema.input} -> 'record' ->> 'type' = ${types.task}`,
        inArray(sql<string>`${workerRunSchema.input} -> 'record' ->> 'id'`, taskIds),
      ))).map(r => ({ id: r.id, status: r.status, kind: r.kind, error: r.error, failures: (r.failures ?? []) as RunRow['failures'], input: (r.input ?? {}) as Meta, result: (r.result ?? null) as Meta | null, updatedAt: r.updatedAt, createdAt: r.createdAt, workerVersion: r.workerVersion ?? null })).sort((a, b) => b.id - a.id);
  const refs = new Set([`request:${requestId}`, ...taskIds.map(id => `engineering_task:${id}`)]);
  const openAsks = (await db.select({ id: askSchema.id, refs: askSchema.objectRefs }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'))))
    .filter(a => (a.refs ?? []).some(r => refs.has(`${r.type}:${r.id}`)))
    .map(a => a.id);
  // AN APPROVED PLAN IS NOT WAITING (#130, 2026-09-29): a person approved
  // plan #136 from chat while a second approve card for it sat pending, and
  // the build the approval starts was skipped as "already waiting".
  // A card for a plan whose row was rejected or superseded is moot, not a
  // person's move (2026-09-30, #130: approve card #5158 for rejected plan #136
  // held the request for fourteen hours).
  const planIds = plans.filter(p => String(p.meta.status ?? '') !== 'approved' && !planClosed(p)).map(p => String(p.id));
  const pending = await db.select({ actionId: actionRunSchema.actionId, input: actionRunSchema.input }).from(actionRunSchema).where(and(
    eq(actionRunSchema.orgId, orgId),
    inArray(actionRunSchema.actionId, [DISPATCH, APPROVE_PLAN]),
    // Only a card waiting on a person holds the factory back. An approved or
    // executing dispatch is this very chain in flight (a dispatch that went
    // to planning, whose plan is now being approved), not someone's move.
    eq(actionRunSchema.status, 'pending'),
  ));
  // A PLAN IN REVIEW IS A PERSON'S MOVE TOO (#130, 2026-09-29): a re-plan
  // refreshed plan #136's own pending proposal in place (0.80, under the bar),
  // so no new plan was created, and the sweep read "ended without filing a
  // plan", planned again twice and asked a person to "write the plan" — one
  // that was written and waiting for them.
  // The ROW's status decides (2026-09-30, #130: plan #136's row read rejected
  // while its metadata still said in_review, and the request sat "waiting on a
  // person" for a plan nobody could approve).
  const waiting = plans.some(p => String(p.meta.status ?? '') === 'in_review' && !planClosed(p)) || pending.some((a) => {
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
 * Whether a plan is stale by the records: its components name app or package
 * roots the repo record no longer lists (`stalePlanRoots`). Null when it fits,
 * when there is no plan, or when no repo record says what the tree is.
 * @param orgId - Tenant.
 * @param planId - The plan the failed run was built from.
 * @param request - The request, for its product.
 * @param request.meta
 */
async function planStaleness(orgId: string, planId: number | null | undefined, request: { meta: Meta }): Promise<NonNullable<Failure['stale']> | null> {
  if (!planId) {
    return null;
  }
  const { readRecord, readRepo } = await lib();
  const plan = await readRecord(orgId, planId);
  if (!plan) {
    return null;
  }
  const slug = Array.isArray(plan.meta.repoSlugs) ? String((plan.meta.repoSlugs as unknown[])[0] ?? '') || null : null;
  const product = typeof request.meta.product === 'string' ? request.meta.product : null;
  const repo = await readRepo(orgId, slug ?? (typeof request.meta.ownerRepo === 'string' ? request.meta.ownerRepo : null), product);
  const components = Array.isArray(plan.meta.components) ? (plan.meta.components as unknown[]).map(String) : [];
  return stalePlanRoots(components, repo);
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
  const fires = await db.select({ id: automationRunSchema.id, slug: automationRunSchema.slug, status: automationRunSchema.status, error: automationRunSchema.error, targetRunId: automationRunSchema.targetRunId }).from(automationRunSchema).where(and(
    eq(automationRunSchema.orgId, orgId),
    inArray(automationRunSchema.slug, slugs),
    gte(automationRunSchema.startedAt, new Date(Date.parse(askedAt) - 1000)),
    sql`${automationRunSchema.input} ->> 'requestId' = ${String(requestId)}`,
  ));
  if (fires.length === 0 || fires.some(f => f.status === 'running')) {
    return null;
  }
  const last = [...fires].sort((a, b) => b.id - a.id)[0]!;
  // What the planning run was told when it made its required call, in the
  // tool's own words — read off THAT run (its mission run's calls) and the
  // call its automation requires (`do.requireTool`), never a tool name
  // written here or a call some other turn made in the same window.
  const { desc } = await import('drizzle-orm');
  const { automationSchema, toolCallSchema } = await import('@/models/Schema');
  const [auto] = await db.select({ doConfig: automationSchema.doConfig }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, last.slug))).limit(1);
  const required = auto?.doConfig?.requireTool;
  const [filing] = required && last.targetRunId
    ? await db.select({ output: toolCallSchema.output, error: toolCallSchema.error }).from(toolCallSchema).where(and(
        eq(toolCallSchema.orgId, orgId),
        eq(toolCallSchema.missionRunId, last.targetRunId),
        eq(toolCallSchema.tool, required),
      )).orderBy(desc(toolCallSchema.id)).limit(1)
    : [];
  const told = (filing?.error || filing?.output || '').trim().slice(0, 400);
  return { why: `the planning run (${nounCode('automation', last.id)}) ended without filing a plan${told ? `; its filing was answered: "${told}"` : filing || !required ? '' : `; it never called ${required}`}${last.error ? `; the run failed: ${last.error.split('\n')[0]!.slice(0, 200)}` : ''}` };
}

/**
 * Whether a request is open for the factory to act on at all.
 * @param orgId - Tenant, whose plugin names the request type.
 * @param request - The request.
 */
async function isOpen(orgId: string, request: FactoryRecord): Promise<boolean> {
  // A DUPLICATE IS CLOSED (#232/#234, 2026-09-29): `duplicateOf` ends the
  // record by itself — intake already skipped one; the sweep carried it on.
  // SETTLED IS CLOSED: the type's `x-settled`, or a ship (request 224 read
  // `building` after it shipped, and the sweep went on carrying it).
  return request.typeSlug === (await factoryTypes(orgId)).request && !settledReason(request) && request.meta.recommendationState !== 'rejected' && !(Number(request.meta.duplicateOf ?? 0) > 0);
}

/**
 * Open, and moved on by these handlers: not a request its durable workflow
 * owns (backlog 054). The one check every handler that would start, retry,
 * re-plan or sweep a request on its own asks; a handler that only turns a
 * person's or a plan's ask into a dispatch still runs, since the dispatch
 * tells the workflow.
 * @param orgId - Tenant.
 * @param request - The request.
 */
async function carriedHere(orgId: string, request: FactoryRecord): Promise<boolean> {
  return (await isOpen(orgId, request)) && !(await ownedHere(orgId, request));
}

/**
 * Whether the request's durable workflow owns it (backlog 054).
 * @param orgId - Tenant.
 * @param request - The request.
 */
async function ownedHere(orgId: string, request: FactoryRecord): Promise<boolean> {
  const { ownedByWorkflow } = await import('./requestWorkflowStart');
  return ownedByWorkflow(orgId, request.meta);
}

/**
 * STOP A REQUEST FOR A PERSON, from its workflow: the same one ask the
 * recovery files, naming why and that Build again continues it.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param why - Why it stopped.
 */
export async function stopRequestForPerson(orgId: string, requestId: number, why: string): Promise<void> {
  const { readRecord } = await lib();
  const request = await readRecord(orgId, requestId);
  if (request) {
    await escalate(orgId, request, why, 'press Build again with a note on what to change; the workflow continues the latest branch');
  }
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
  const attempts = state.attempts.map(a => `${a.n}. ${a.kind === 'plan' ? 'Plan' : 'Build'}${a.runId ? ` (${nounCode('run', a.runId)})` : ''}: ${a.line}${a.failure ? ` — failed: ${a.failure.sentence}` : ''}`);
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
        priorDecided ? `This is a new stop: ${nounCode('ask', priorDecided.id)} on this request was already decided (${priorDecided.status}) and does not answer this one.` : null,
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
      objectRefs: [{ type: (await factoryTypes(orgId)).request, id: String(request.id) }],
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
    throw new Error(`escalation for request #${request.id} did not produce an open ask (${nounCode('ask', ask.id)} is ${ask.status})`);
  }
  if (priorDecided) {
    await linkAskGroup(orgId, priorDecided.id, priorDecided.groupKey ?? `factory-recovery:${request.id}`);
  }
  await updateRecovery(orgId, request.id, s => logLine({ ...s, stage: 'stopped', line, askId: ask.id }, `Stopped after ${s.attempts.length} attempt${s.attempts.length === 1 ? '' : 's'}: ${line} ${nounCode('ask', ask.id)} is with a person.`, now.toISOString()));
  // The typed moment a person is needed (backlog 048): what the plugin's
  // "needs a person" notification is declared on. After the ask exists, so a
  // notification never points at a question that is not there; deduped on
  // the request and the ask, so a sweep refreshing this stop raises nothing.
  const { emitEvent, FACTORY_STOPPED } = await import('@/services/EventService');
  const payload: import('@/services/EventService').FactoryStoppedPayload = {
    requestId: request.id,
    title: request.title,
    askId: ask.id,
    why: why.replace(/[.\s]+$/, ''),
    unblock,
    line,
    attempts: state.attempts.length,
    failure: failure?.class ?? null,
  };
  await emitEvent({ orgId, type: FACTORY_STOPPED, payload, dedupeKey: `${FACTORY_STOPPED}:${request.id}:${ask.id}`, invokedBy: `factory:${PM}`, dispatchMode: 'auto' }).catch((err) => {
    console.warn('[factory] could not raise factory.stopped', { requestId: request.id, error: (err as Error).message });
  });
  return line;
}

/**
 * The seat that owns the pipeline: the agent the reconcile automation runs
 * as (`factory-reconcile`, core's own job) — the plugin says which, never core.
 * @param orgId - Tenant.
 */
async function pipelineOwner(orgId: string): Promise<{ slug: string | null; name: string }> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema, automationSchema } = await import('@/models/Schema');
  const { FACTORY_RECONCILE_JOB } = await import('@/services/jobs/factoryCarry');
  const [auto] = await db.select({ owner: automationSchema.ownerAgentSlug, input: sql<string | null>`${automationSchema.doConfig} -> 'input' ->> 'owner'` }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), sql`${automationSchema.doConfig} ->> 'job' = ${FACTORY_RECONCILE_JOB}`)).limit(1);
  const slug = auto?.input ?? auto?.owner ?? null;
  if (!slug) {
    return { slug: null, name: 'the pipeline\'s owner' };
  }
  const [agent] = await db.select({ name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))).limit(1);
  return { slug, name: agent?.name?.trim() || slug };
}

/**
 * AN INCOMPATIBLE CONTRACT GOES TO THE PIPELINE'S OWNER, NOT TO A PERSON
 * (2026-10-01, #294: "checks is not a contract field" became ask #267 to a
 * person, for a field name Vocion's own code wrote). The request is held —
 * stopped, with no ask, waiting on the pipeline's owner by name — and the
 * owner hears it once (`pipeline.needs_fix`, keyed on the request and its
 * attempt). A new worker or a new deploy starts the build again on its own
 * (`resumeAfterWorkerRebuild`, which reads a held stop like any other).
 * @param orgId - Tenant.
 * @param request - The request.
 * @param run - The refused run.
 * @param run.id - Its id.
 * @param run.input - Its input, whose contract names the repository.
 * @param why - What held it.
 * @param failure - The refusal.
 * @param now - The clock.
 */
async function holdForPipeline(orgId: string, request: FactoryRecord, run: { id: number; input: Meta }, why: string, failure: Failure, now: Date): Promise<string> {
  const owner = await pipelineOwner(orgId);
  const task = (run.input.task ?? {}) as Meta;
  const repo = (await import('./environments')).fullNameOf(task.repo) ?? String(task.repo ?? '');
  const branch = repo ? await (await import('./githubChange')).defaultBranch(orgId, repo).catch(() => 'the default branch') : 'the default branch';
  const line = `${why.replace(/[.\s]+$/, '')}. ${owner.name} has it; the build starts again on its own once the worker is rebuilt or Vocion is deployed. Nothing needs you.`;
  const at = now.toISOString();
  await updateRecovery(orgId, request.id, s => logLine({ ...s, stage: 'stopped', line, askId: null, waitingOn: { who: owner.name, line, actionRunId: null } }, line, at, run.id));
  await recordRunLine(orgId, run.id, line);
  const { raisePipelineFix } = await import('./pipelineChange');
  await raisePipelineFix(orgId, {
    recordId: request.id,
    requestId: request.id,
    title: request.title,
    repo,
    branch,
    cause: 'contract_incompatible',
    why: `The worker refused the contract Vocion wrote for ${nounCode('run', run.id)}: ${failure.sentence}. Vocion's contract and the worker's schema disagree; nothing was cloned and no model was called.`,
    failing: 'contract',
    url: `/dashboard/p/runs/${run.id}`,
    owner: owner.slug,
    now,
  }).catch((err: Error) => {
    console.warn('[factory] could not hand an incompatible contract to the pipeline\'s owner', { requestId: request.id, runId: run.id, message: err.message });
  });
  return line;
}

/**
 * A CHECK THAT CANNOT RUN STOPS ON ITS REPO RECORD (FE-224, 2026-10-02: four
 * runs failed `sh: 1: Syntax error` and `sh: 1: the: not found` on REPO-27's
 * prose check commands, and recovery retried the code three times, about $8).
 * One typed stop, no attempt spent and no card: the line names each broken
 * command, the record it is on, and who fixes it (the record's owner, else the
 * seat that owns the pipeline). `checkConfigStop` on the request remembers the
 * commands, so the sweep continues the build once the record changes
 * (`resumeAfterCheckFix`).
 * @param orgId - Tenant.
 * @param request - The request.
 * @param run - The run that could not run its checks.
 * @param run.id - Its id.
 * @param run.input - Its input, whose contract names the repository and the commands.
 * @param why - What stopped it.
 * @param failure - The failure, with each command that cannot run.
 * @param now - The clock.
 */
async function stopOnRepoRecord(orgId: string, request: FactoryRecord, run: { id: number; input: Meta }, why: string, failure: Failure, now: Date): Promise<string> {
  const task = (run.input.task ?? {}) as Meta;
  const { readRepo, writeMeta } = await lib();
  const slug = (await import('./environments')).fullNameOf(task.repo) ?? null;
  const repo = await readRepo(orgId, slug, typeof request.meta.product === 'string' ? request.meta.product : null).catch(() => null);
  const ref = (repo && typeof repo.recordCode === 'string' && repo.recordCode) || (slug ? `the repo record for ${slug}` : 'the repo record');
  const owners = repo && Array.isArray(repo.owners) ? (repo.owners as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
  const who = owners[0] ?? (await pipelineOwner(orgId)).name;
  const given = new Map((Array.isArray(task.checks) ? task.checks as Array<{ name?: unknown; command?: unknown }> : []).map(c => [String(c.name ?? ''), String(c.command ?? '')]));
  const checks = (failure.notRunnable ?? []).map(c => ({ name: c.name, command: c.command || given.get(c.name) || '' }));
  const broken = checks.map(c => `${c.name} (\`${c.command}\`)`).join(', ');
  const line = `${why.replace(/[.\s]+$/, '')}. ${who} fixes the check command${checks.length === 1 ? '' : 's'} on ${ref}: ${broken}; the build continues on its own once the record changes. Nothing was built and nothing was spent on the model.`;
  const at = now.toISOString();
  await writeMeta(orgId, request.id, { checkConfigStop: { runId: run.id, repo: ref, recordId: repo?.recordId ?? null, owner: who, checks, at } });
  await updateRecovery(orgId, request.id, s => logLine({ ...s, stage: 'stopped', line, askId: null, waitingOn: { who, line, actionRunId: null } }, line, at, run.id));
  return line;
}

/**
 * THE BUILD CONTINUES ONCE THE CHECK COMMAND IS FIXED. A request stopped on a
 * check that could not run (`stopOnRepoRecord`) is read again by the sweep:
 * when the contract the records give now carries a different command for any
 * check that could not run, the stop clears and the build is sent again as a
 * recovery of that run, so it continues the branch the work is on.
 * @param orgId - Tenant.
 * @param request - The request (stopped, nothing live).
 * @param now - The clock.
 */
export async function resumeAfterCheckFix(orgId: string, request: FactoryRecord, now: Date = new Date()): Promise<CarryResult | null> {
  const stop = request.meta.checkConfigStop && typeof request.meta.checkConfigStop === 'object' ? request.meta.checkConfigStop as Meta : null;
  const runId = Number(stop?.runId);
  if (!stop || !Number.isInteger(runId) || runId <= 0) {
    return null;
  }
  const { previewContract, writeMeta } = await lib();
  const work = await workFor(orgId, request.id);
  // A newer run since the stop (a person pressed Build) answered it, one way or another.
  if (work.runs[0] && work.runs[0].id !== runId) {
    await writeMeta(orgId, request.id, { checkConfigStop: null });
    return null;
  }
  const planId = (await approvedPlan(work.plans))?.id;
  const base = { requestId: request.id, ...(planId ? { planId } : {}) };
  const preview = await previewContract(orgId, base);
  const current = new Map((Array.isArray(preview?.checks) ? preview!.checks as Array<{ name?: unknown; command?: unknown }> : []).map(c => [String(c.name ?? ''), String(c.command ?? '')]));
  const was = (Array.isArray(stop.checks) ? stop.checks as Array<{ name?: unknown; command?: unknown }> : []).map(c => ({ name: String(c.name ?? ''), command: String(c.command ?? '') }));
  const changed = was.filter(c => (current.get(c.name) ?? '') !== c.command);
  if (changed.length === 0) {
    return null;
  }
  const line = `The check command${changed.length === 1 ? '' : 's'} for ${changed.map(c => c.name).join(', ')} on ${String(stop.repo ?? 'the repo record')} changed since ${nounCode('run', runId)} could not run ${changed.length === 1 ? 'it' : 'them'}; building again.`;
  await writeMeta(orgId, request.id, { checkConfigStop: null });
  await updateRecovery(orgId, request.id, s => logLine({ ...s, stage: null, line: null, waitingOn: null }, line, now.toISOString(), runId));
  const out = await propose(orgId, DISPATCH, { ...base, trigger: 'recovery', recoveryOfRun: runId, recoveryClass: 'check_not_runnable', reason: line }, {
    confidence: 0.9,
    rationale: `${nounCode('run', runId)} stopped because a check command could not run; the repo record now gives a different command.`,
    reason: 'The configuration that stopped it changed; Undo cancels it until a worker claims it.',
  });
  if (!out.ok) {
    const stopped = await escalate(orgId, request, `Stopped: the check command was fixed, but the build could not start: ${out.error}`, 'fix what the dispatch refused on, then press Build');
    return { requestId: request.id, did: 'check fixed:refused', line: stopped };
  }
  await recordRunLine(orgId, runId, line);
  return { requestId: request.id, did: `check fixed:${out.res.status}`, line };
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
  if (attemptsOf(state, 'build') < state.limit) {
    return null;
  }
  return escalate(orgId, request, `Stopped after ${attemptsOf(state, 'build')} automatic build attempts: ${why}`, 'read what QA asked for and press Build with a note on what to change');
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
  const { planClosed } = await lib();
  const open = opts.plan && !planClosed(opts.plan)
    ? opts.plan
    : [...work.plans].filter(p => !planClosed(p)).sort((a, b) => b.id - a.id)[0] ?? null;
  await updateRecovery(orgId, opts.request.id, (s) => {
    const base = opts.counted ? s : personActed(s, opts.at, `Build pressed by ${opts.by}.`);
    return opts.counted
      ? noteAttempt(base, { at: opts.at, kind: 'plan', trigger: opts.trigger ?? 'recovery', runId: null, taskId: null, line: opts.why })
      : logLine({ ...base, stage: 'planning', line: `Planning — ${opts.why}`, planRequestedAt: opts.at }, `Planning first: ${opts.why}`, opts.at);
  });
  // A person's Build reopens a finished request; an automatic plan never does.
  await markStatus(orgId, opts.request.id, 'planning', { line: `Planning first: ${opts.why}`, reopen: !opts.counted, at: opts.at });
  if (open && planIsApproved(open.meta)) {
    const built = await buildFromApprovedPlan(orgId, { planId: open.id, requestId: opts.request.id, approvedBy: String(open.meta.approvedBy ?? 'a person'), byPerson: false });
    // NEVER "PLANNING" WITH NOTHING PLANNING (#130, 2026-10-02): the plan is
    // already approved, so when its build does not start the request says why.
    if (built.line === null) {
      const planName = await codeForRecord(orgId, open.id).catch(() => null) ?? `plan #${open.id}`;
      const line = `${planName} is approved; the build did not start: ${built.did}.`;
      await updateRecovery(orgId, opts.request.id, s => logLine({ ...s, line }, line, new Date().toISOString()));
    }
    return { planId: open.id, via: 'approval', previous };
  }
  if (open) {
    await reviewFiledPlan(orgId, { objectId: open.id, objectType: (await factoryTypes(orgId)).plan });
    return { planId: open.id, via: 'approval', previous };
  }
  const { FACTORY_PLAN_REQUESTED, emitEvent } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: FACTORY_PLAN_REQUESTED,
    payload: { requestId: opts.request.id, title: opts.request.title, why: opts.why },
    dedupeKey: `${FACTORY_PLAN_REQUESTED}:${opts.request.id}:${opts.at}`,
    // The factory's own step, in the PM's name but not the PM's turn (same
    // stamp `replan` below uses): the mission check this fires carries it as
    // `ctx.userId`, so the plan filing it prompts is bounded by the attempt
    // limit, not the PM's weekly idea cap (`isFactoryStep`).
    invokedBy: `factory:${PM}`,
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
 * @param opts
 * @param opts.retry
 */
export async function intakeFiledRequest(orgId: string, payload: Partial<ObjectCreatedPayload>, opts: { retry?: boolean } = {}): Promise<CarryResult> {
  const { readRecord, writeMeta } = await lib();
  const id = Number(payload.objectId);
  if (payload.objectType !== (await factoryTypes(orgId)).request || !Number.isInteger(id) || id <= 0) {
    return skip(null, 'not a request');
  }
  const request = await readRecord(orgId, id);
  if (!request || !(await isOpen(orgId, request))) {
    return skip(id, 'not an open request');
  }
  // THE SAME ASK TWICE (#265/#268, 2026-09-30): before anything is built,
  // a model reads whether this repeats a request already on file. Linked
  // (done for you, Undo on the record), its work is the other one's and
  // nothing starts; below the bar nothing is said and intake carries on.
  const { checkNewRecordForDuplicate } = await import('@/services/objects/duplicateCheck');
  const duplicate = opts.retry ? null : await checkNewRecordForDuplicate(orgId, payload);
  if (duplicate?.linked && duplicate.line) {
    const line = duplicate.line;
    await updateRecovery(orgId, id, s => logLine(s, line, new Date().toISOString()));
    return { requestId: id, did: `duplicate:${duplicate.did}`, line: duplicate.line };
  }
  const work = await workFor(orgId, id);
  if (work.tasks.length > 0 || work.waiting) {
    return skip(id, 'work already exists for it');
  }
  // THE PRODUCT IS READ, NOT GUESSED (2026-10-01, #294: asked about Stamp's
  // document page, filed under Slate). A model reads the person's words
  // against the records the type names (`x-reference-read`); a confident read
  // that disagrees wins, done for you with Undo, before anything is built.
  const reread = await correctReference(orgId, request, payload);
  const filed = reread ?? request;
  const decision = intakeDecision({ meta: filed.meta, origin: { conversationId: typeof payload.conversationId === 'number' ? payload.conversationId : null, byPerson: payload.byPerson === true } });
  if (decision.do === 'skip') {
    return skip(id, `left to triage: ${decision.why}`);
  }
  const plan = await approvedPlan(work.plans);
  const at = new Date().toISOString();
  // A BUILD THAT WOULD BE REFUSED IS NOT PROPOSED (2026-10-01, #294): what
  // the dispatch would refuse on is read first, typed, and routed — the repo
  // the product lists, planning with the gap as its brief, or a blocker that
  // says what is wrong and who fixes it. Never "no card" and silence.
  let readiness: BuildReadiness | null = null;
  // Who filed it, kept on the mark, so a retry by the sweep runs as the same person.
  const from: IntakeMark['from'] = { conversationId: typeof payload.conversationId === 'number' ? payload.conversationId : null, byPerson: payload.byPerson === true, actor: typeof payload.actor === 'string' ? payload.actor : null };
  const mark = (m: Omit<IntakeMark, 'tries' | 'from'>) => markIntake(orgId, filed, { ...m, from });
  // A PERSON'S REQUEST BUILDS BY DEFAULT (Chris, 2026-09-30: "do i have to
  // say 'file it and build it'? Should it not get intent? Should that not be
  // the default assumption for anything that isn't high risk?"). Asking for it
  // is the intent, so the build is the person's own action, started now with
  // Undo. Risk is judged where it can be seen: the plan's approval on its trust
  // bar, and the merge's rule for its risk class. What holds it here is only
  // the person's word to hold it, read by a model, never matched; then it is
  // the Build card. An idea an agent filed on its own schedule is not a
  // person's ask, and stays a card.
  const conversationId = typeof payload.conversationId === 'number' ? payload.conversationId : null;
  const person = payload.byPerson === true ? await filingPerson(orgId, conversationId, payload.actor) : null;
  if (person) {
    const held = conversationId !== null
      ? await personSaidTo(orgId, conversationId, `hold request #${id} "${filed.title}": only file it, and do not start building it yet`).catch(() => null)
      : null;
    if (held) {
      await updateRecovery(orgId, id, s => logLine(s, 'Filed and held, as you asked: the Build card waits for you.', at));
      await mark({ at, outcome: 'held' });
    } else {
      readiness = await readinessOf(orgId, id, plan?.id ?? null);
      if (!readiness.ready) {
        return await routeUnready(orgId, filed, readiness, { at, plan: !!plan, by: person, mayPlan: true, from });
      }
      const started = await proposeAsPerson(orgId, person, conversationId, DISPATCH, { requestId: id, ...(plan ? { planId: plan.id } : {}), trigger: 'request', reason: 'A person asked for it.' }, {
        confidence: 0.9,
        rationale: `A person asked for this${conversationId !== null ? ` in ${nounCode('conversation', conversationId)}` : ''}; its acceptance is written (${decision.why}).`,
        reason: 'Asked for by a person; Undo cancels it until a worker claims it.',
      });
      if (started.ok && started.res.status !== 'pending') {
        const line = 'Filed and started: you asked for it. Undo cancels it until a worker claims it.';
        await updateRecovery(orgId, id, s => logLine(s, line, at));
        await mark({ at, outcome: 'started' });
        return { requestId: id, did: `start:${started.res.status}:person`, line };
      }
      // Refused or held by the action itself: said here, and the card carries it.
      await updateRecovery(orgId, id, s => logLine(s, `Filed; the build could not start on its own: ${started.ok ? `it is waiting on a card (${nounCode('action', started.res.runId)})` : started.error}`, at));
      await mark({ at, outcome: started.ok ? 'card' : 'refused', ...(started.ok ? {} : { why: started.error }) });
      if (started.ok) {
        return { requestId: id, did: `card:${started.res.status}:person`, line: null };
      }
    }
  }
  readiness ??= await readinessOf(orgId, id, plan?.id ?? null);
  if (!readiness.ready) {
    // A person's request was answered above; what reaches here is the
    // factory's own start or a card, so planning is only for a fix it starts.
    return await routeUnready(orgId, filed, readiness, { at, plan: !!plan, by: null, mayPlan: decision.do === 'start', from });
  }
  if (decision.do === 'start') {
    const out = await propose(orgId, DISPATCH, { requestId: id, ...(plan ? { planId: plan.id } : {}), trigger: 'request', reason: `Started on its own: ${decision.why}.` }, {
      confidence: 0.9,
      rationale: `A fix with its acceptance written: ${decision.why}.`,
      reason: 'The build starts now, and Undo cancels it until a worker claims it.',
    });
    const line = !out.ok
      ? `Filed; the build could not start: ${out.error}`
      : out.res.status === 'pending' ? `Filed; the build is on a card for a person (${nounCode('action', out.res.runId)}): ${decision.why}.` : `Filed and started on its own: ${decision.why}.`;
    await updateRecovery(orgId, id, s => logLine(s, line, at));
    await mark({ at, outcome: !out.ok ? 'refused' : out.res.status === 'pending' ? 'card' : 'started', ...(out.ok ? {} : { why: out.error }) });
    return { requestId: id, did: out.ok ? `start:${out.res.status}` : 'start:refused', line };
  }
  const out = await propose(orgId, DISPATCH, { requestId: id, ...(plan ? { planId: plan.id } : {}), reason: `Ready to build: ${decision.why}.` }, {
    confidence: 0.5,
    rationale: `The request carries its acceptance criteria; ${decision.why}.`,
    reason: 'Its acceptance is written, so it can be built as soon as a person says so.',
  });
  if (!out.ok) {
    // Refused for a reason the readiness read did not foresee: said on the
    // request's own account, and marked, so the sweep carries it on.
    const line = `Filed; the Build card could not be made: ${out.error}`;
    await updateRecovery(orgId, id, s => logLine(s, line, at));
    await mark({ at, outcome: 'refused', why: out.error });
    return { requestId: id, did: 'card:refused', line };
  }
  if (!filed.meta.recommendationState) {
    await writeMeta(orgId, id, { recommendationState: 'proposed', recommendedAt: at, recommendedOutcome: 'build' });
  }
  const line = `Filed; the Build card is waiting on a person (${nounCode('action', out.res.runId)}).`;
  await updateRecovery(orgId, id, s => logLine(s, line, at));
  await markStatus(orgId, id, 'build_card', { line, at });
  await mark({ at, outcome: 'card' });
  return { requestId: id, did: `card:${out.res.status}`, line };
}

/**
 * The reference read on a filed request (`services/objects/referenceRead.ts`):
 * when it corrected a field, the line goes on the request's account and the
 * request is read fresh. Null when nothing changed.
 * @param orgId - Tenant.
 * @param request - The request.
 * @param payload - Where it was filed from.
 */
async function correctReference(orgId: string, request: FactoryRecord, payload: Partial<ObjectCreatedPayload>): Promise<FactoryRecord | null> {
  const { readReference } = await import('@/services/objects/referenceRead');
  const read = await readReference(orgId, payload);
  if (!read.line) {
    return null;
  }
  const line = read.line;
  await updateRecovery(orgId, request.id, s => logLine(s, line, new Date().toISOString(), read.runId));
  if (!read.corrected) {
    return null;
  }
  const { readRecord } = await lib();
  return readRecord(orgId, request.id);
}

/** What intake did with a request last, typed, so the sweep can carry on one it could not start. */
export type IntakeMark = {
  at: string;
  /** How many times intake has read it. */
  tries: number;
  outcome: 'started' | 'card' | 'planning' | 'blocked' | 'held' | 'refused';
  /** The blocker's cause, or the refusal, when it did not start. */
  cause?: BuildReadiness['cause'];
  why?: string;
  /** Who filed it, as the filing event said, so a retry runs as them. */
  from?: { conversationId: number | null; byPerson: boolean; actor: string | null };
};

/**
 * The request's intake mark, read.
 * @param meta - The request's metadata.
 */
export function readIntake(meta: Meta): IntakeMark | null {
  const m = meta.intake;
  return m && typeof m === 'object' && !Array.isArray(m) && typeof (m as Meta).at === 'string' ? m as IntakeMark : null;
}

async function markIntake(orgId: string, request: FactoryRecord, mark: Omit<IntakeMark, 'tries'>): Promise<void> {
  const { readRecord, writeMeta } = await lib();
  const fresh = await readRecord(orgId, request.id);
  const before = readIntake(fresh?.meta ?? request.meta);
  const tries = (before?.tries ?? 0) + 1;
  const from = mark.from && (mark.from.byPerson || mark.from.conversationId !== null) ? mark.from : before?.from ?? mark.from;
  await writeMeta(orgId, request.id, { intake: { ...mark, ...(from ? { from } : {}), tries } });
}

async function readinessOf(orgId: string, requestId: number, planId: number | null): Promise<BuildReadiness> {
  const { buildReadiness } = await lib();
  // A read that fails is not a finding: the dispatch's own precheck still runs.
  return buildReadiness(orgId, requestId, planId).catch(() => ({ ready: true, cause: null, gaps: [], product: null, repo: null }));
}

/**
 * A request whose build would be refused, routed on why (2026-10-01, #294).
 * The records are the fault, so a person who can fix them is named: no repo
 * is a blocker on the product's owner, a repo with no checks a blocker on the
 * repo's owner. Anything else a plan supplies, so the request is planned,
 * with what the contract lacks as the brief, when planning is the factory's
 * to start; otherwise the same gap is a blocker. The blocker clears itself
 * once the records say otherwise (`carryBlockedIntake`).
 * @param orgId - Tenant.
 * @param request - The request.
 * @param r - Why it is not ready.
 * @param o - How intake got here.
 * @param o.at - When.
 * @param o.plan - Whether an approved plan was named.
 * @param o.by - The person whose request it is, when it is one.
 * @param o.mayPlan - Whether the factory may start planning on its own.
 * @param o.from - Who filed it, kept on the mark.
 */
async function routeUnready(orgId: string, request: FactoryRecord, r: BuildReadiness, o: { at: string; plan: boolean; by: string | null; mayPlan: boolean; from: IntakeMark['from'] }): Promise<CarryResult> {
  const id = request.id;
  const { writeMeta } = await lib();
  if (r.cause === 'needs_plan' && o.mayPlan) {
    const why = `the build's contract has no ${r.gaps.join(', ') || 'source it can be read from'} yet, and a plan names ${r.gaps.length === 1 ? 'it' : 'them'}`;
    await startPlanning(orgId, { request: { id, title: request.title, meta: request.meta }, plan: null, why, counted: true, trigger: 'request', by: o.by ?? PM, at: o.at });
    await markIntake(orgId, request, { at: o.at, outcome: 'planning', cause: r.cause, why, from: o.from });
    return { requestId: id, did: 'planning:unready', line: `Planning first: ${why}.` };
  }
  const blocker = unreadyBlocker(r, o.at);
  await writeMeta(orgId, id, { blocker });
  const line = `Blocked: ${blocker.what}. ${blocker.owner ? `${blocker.owner} can` : 'Someone who can edit the records can'} ${blocker.next}.`;
  await updateRecovery(orgId, id, s => logLine(s, line, o.at));
  await markIntake(orgId, request, { at: o.at, outcome: 'blocked', cause: r.cause, why: blocker.what, from: o.from });
  return { requestId: id, did: `blocked:${r.cause ?? 'unready'}`, line };
}

/**
 * The blocker a build that cannot start leaves: what is wrong, who fixes it,
 * the one move. Pure.
 * @param r - Why it is not ready.
 * @param at - When.
 */
export function unreadyBlocker(r: BuildReadiness, at: string): { what: string; owner: string | null; next: string; since: string; cause: NonNullable<BuildReadiness['cause']> } {
  const name = r.product?.title ?? null;
  if (r.cause === 'no_repo') {
    return {
      what: name ? `Nothing says which repository ${name} is built in, so it cannot be built` : 'This request names no product with a repository, so it cannot be built',
      owner: r.product?.owner ?? null,
      next: name ? `add a repo record for ${name} (or list one in its repos), or move this request to the product it is for` : 'set the product this request is for',
      since: at,
      cause: 'no_repo',
    };
  }
  if (r.cause === 'no_checks') {
    return {
      what: `The repo record ${r.repo ?? ''} lists no checks, so a build of it could not be proven`.replace('  ', ' '),
      owner: r.repoOwner ?? r.product?.owner ?? null,
      next: `add the checks its CI runs to the repo record ${r.repo ?? ''}`.trim(),
      since: at,
      cause: 'no_checks',
    };
  }
  return {
    what: `The build has no ${r.gaps.join(', ') || 'contract'} yet`,
    owner: r.product?.owner ?? null,
    next: 'press Build to plan it first, or write a plan that names them',
    since: at,
    cause: 'needs_plan',
  };
}

/**
 * Who approves a plan for this request, in words a person reads: the
 * product's accountable owner, else the person who asked, else "a person".
 * @param orgId - Tenant.
 * @param request - The request.
 */
async function planApprover(orgId: string, request: FactoryRecord): Promise<string> {
  const { readProduct } = await lib();
  const product = await readProduct(orgId, typeof request.meta.product === 'string' ? request.meta.product : null).catch(() => null);
  if (product?.owner) {
    return product.owner;
  }
  const origin = request.meta.origin && typeof request.meta.origin === 'object' ? request.meta.origin as Meta : {};
  const asker = typeof request.meta.askedBy === 'string' && request.meta.askedBy.trim() ? request.meta.askedBy.trim() : null;
  return asker ?? (typeof origin.userId === 'string' ? 'the person who asked' : 'a person');
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
  if (payload.objectType !== (await factoryTypes(orgId)).plan || !Number.isInteger(planId)) {
    return skip(null, 'not a plan');
  }
  const plan = await readRecord(orgId, planId);
  const requestId = Number(plan?.meta.requestId);
  const request = Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
  if (!plan || !request || !(await isOpen(orgId, request))) {
    return skip(Number.isInteger(requestId) ? requestId : null, 'no open request for this plan');
  }
  if (readRecovery(request.meta).stage !== 'planning') {
    return skip(requestId, 'the factory did not ask for this plan');
  }
  if (planIsApproved(plan.meta)) {
    return buildFromApprovedPlan(orgId, { planId, requestId, approvedBy: String(plan.meta.approvedBy ?? 'a person'), byPerson: false });
  }
  // THE NEW PLAN SUPERSEDES THE STALE ONE, on both records: the old plan
  // says what replaced it, the new one what it replaces.
  const replaced = (await workFor(orgId, requestId)).plans.filter(p => p.id !== planId && p.meta.status === 'superseded' && !p.meta.supersededBy).map(p => p.id);
  if (replaced.length > 0) {
    const { writeMeta } = await lib();
    for (const id of replaced) {
      await writeMeta(orgId, id, { supersededBy: planId });
    }
    await writeMeta(orgId, planId, { supersedes: replaced });
  }
  const { planConfidence } = await import('@/libs/actions/factory-approve-plan');
  const { confidence, gaps } = planConfidence(plan.meta);
  const content = gaps.filter(g => !g.startsWith('the rule named'));
  // The plan and its request as a person reads them (PL-295, FE-294 — `libs/codes.ts`).
  const planName = await codeForRecord(orgId, planId).catch(() => null) ?? `plan #${planId}`;
  const requestName = await codeForRecord(orgId, requestId).catch(() => null) ?? `request #${requestId}`;
  const out = await propose(orgId, APPROVE_PLAN, { planId, reason: `${planName} is written for ${requestName}.` }, {
    confidence,
    rationale: gaps.length === 0 ? 'The plan states its approach, what changes, what was rejected, how it is verified and what happens to existing data.' : `The plan is missing: ${gaps.join('; ')}.`,
    reason: content.length === 0 ? (gaps.length === 0 ? 'The plan answers everything a plan must.' : 'The plan is complete, and the work is a kind a revert cannot undo, so a person approves it.') : `Send it back: ${content.join('; ')}.`,
    decision: content.length === 0 ? 'approve' : 'reject',
  });
  const at = new Date().toISOString();
  const line = !out.ok
    ? `${planName} written; its approval could not be filed: ${out.error}`
    : out.res.status === 'pending' ? `${planName} written; a person approves it (${nounCode('action', out.res.runId)})${content.length ? ` — missing ${content.join('; ')}` : ''}.` : `${planName} written and approved within the trust bar; Undo puts it back in review.`;
  // WAITING NAMES WHO (2026-10-01): the product's owner approves the plan, or
  // the person who asked, or — said plainly — a person.
  const approver = out.ok && out.res.status === 'pending' ? await planApprover(orgId, request) : null;
  const waiting = approver ? `Planning — ${planName} is written and waiting for ${approver} to approve it.` : null;
  await updateRecovery(orgId, requestId, s => logLine(s.stage === 'planning' ? { ...s, line: waiting ?? s.line, ...(waiting && approver ? { waitingOn: { who: approver, line: waiting, actionRunId: out.ok ? out.res.runId : null } } : {}) } : s, line, at));
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
  if (!plan || !request || !(await isOpen(orgId, request))) {
    return skip(Number.isInteger(requestId) ? requestId : null, 'no open request for this plan');
  }
  const work = await workFor(orgId, requestId);
  await clearResolvedBlocker(orgId, request, work.plans).catch(err => console.warn('[factory] could not read the blocker back', { requestId, error: (err as Error).message }));
  if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting) {
    return skip(requestId, 'a build is already running or waiting');
  }
  const at = new Date().toISOString();
  const by = String(payload.approvedBy ?? 'a person');
  const planName = await codeForRecord(orgId, planId).catch(() => null) ?? `plan #${planId}`;
  if (payload.byPerson === true) {
    await updateRecovery(orgId, requestId, s => personActed(s, at, `${by} approved ${planName}.`));
  }
  const state = readRecovery((await readRecord(orgId, requestId))?.meta);
  if (attemptsOf(state, 'build') >= state.limit) {
    const line = await escalate(orgId, request, `Stopped after ${attemptsOf(state, 'build')} build attempts: the plan is approved, and the limit on automatic builds is reached`, 'press Build to start it');
    return { requestId, did: 'escalate', line };
  }
  const out = await propose(orgId, DISPATCH, { requestId, planId, trigger: 'plan', reason: `${planName} approved by ${by}; the build starts with its paths.` }, {
    confidence: 0.95,
    rationale: `The plan the rule required is approved (${by}); the contract takes its paths from the plan's components.`,
    reason: 'The plan is approved; nothing else stands between it and the build.',
  });
  const line = !out.ok ? `${planName} approved; the build could not start: ${out.error}` : out.res.status === 'pending' ? `${planName} approved; the build is on a card for a person (${nounCode('action', out.res.runId)}).` : `${planName} approved; the build started on its own.`;
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
  if (run.kind !== 'worker' || rec?.type !== (await factoryTypes(orgId)).task) {
    return skip(null, 'not an engineering run');
  }
  if (run.status === 'lost' && now.getTime() - run.updatedAt.getTime() < LOST_GRACE_MS) {
    return skip(null, 'lost too recently; its worker may still re-claim it');
  }
  const task = await readRecord(orgId, rec.id);
  const requestId = Number(task?.meta.requestId);
  const request = task && Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
  if (task && request && (await ownedHere(orgId, request))) {
    return skip(requestId, 'the request\'s workflow owns it');
  }
  if (!task || !request || !(await isOpen(orgId, request))) {
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
    return skip(requestId, `${nounCode('run', work.runs[0].id)} is newer`);
  }
  if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting) {
    return skip(requestId, 'another attempt is already running or waiting');
  }
  if (work.openAsks.length > 0) {
    return skip(requestId, `${nounCode('ask', work.openAsks[0]!)} is open on it`);
  }
  const failure: Failure = classifyFailure({ status: run.status, error: run.error, failures: run.failures as Array<{ scope?: string; message?: string }>, result: (run.result ?? null) as Meta | null });
  const planId = Number(task.meta.planId) > 0 ? Number(task.meta.planId) : (await approvedPlan(work.plans))?.id;
  const base = { requestId, ...(planId ? { planId } : {}) };
  // An older worker says only "no changes"; the records can still show the
  // plan it was sent is stale (#130: plan #136 names apps/send-api).
  const stalePlan = failure.class === 'no_changes' ? await planStaleness(orgId, planId, request) : null;
  let delta: string[] = [];
  if (failure.class === 'no_changes') {
    const before = ((run.input ?? {}) as { task?: Meta }).task ?? {};
    const after = await previewContract(orgId, base);
    delta = after ? contractDelta(before, after) : [];
  }
  let envDelta: string[] = [];
  if (failure.class === 'environment' || failure.class === 'contract_shape') {
    const before = ((run.input ?? {}) as { task?: Meta }).task ?? {};
    const after = await previewContract(orgId, base);
    envDelta = environmentDelta(
      { workerVersion: run.workerVersion ?? null, environment: before.environment ?? null },
      { workerVersion: await newestWorkerVersion(orgId, run), environment: after?.environment ?? null },
    );
  }
  const decision = recoveryDecision({ failure, attempts: attemptsOf(state, 'build'), limit: state.limit, contractDelta: delta, environmentDelta: envDelta, lastWasInfraRetry: ['lost', 'transient'].includes(String(task.meta.recoveryClass ?? '')), stalePlan });
  const handledAs = stalePlan && failure.class === 'no_changes' ? staleFailure(stalePlan) : failure;
  // Handled first, so the event and the sweep never both act on this run.
  await updateRecovery(orgId, requestId, s => markHandled(s, run.id, handledAs));
  let line: string;
  if (decision.do === 'escalate') {
    line = await escalate(orgId, request, decision.why, decision.unblock, handledAs);
  } else if (decision.do === 'configure') {
    line = await stopOnRepoRecord(orgId, request, { id: run.id, input: (run.input ?? {}) as Meta }, decision.why, handledAs, now);
  } else if (decision.do === 'hold') {
    line = await holdForPipeline(orgId, request, { id: run.id, input: (run.input ?? {}) as Meta }, decision.why, handledAs, now);
  } else if (decision.do === 'replan') {
    line = await replanStale(orgId, { request, runId: run.id, planId: planId ?? null, why: decision.why, brief: decision.brief, failure: handledAs, now });
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
      rationale: `${nounCode('run', run.id)} failed: ${failure.sentence}. ${decision.do === 'plan' ? 'The worker refused the contract for want of a plan.' : 'The failure is one the next attempt can answer.'}`,
      reason: 'One automatic attempt within the limit; Undo cancels it until a worker claims it.',
    });
    if (!out.ok) {
      line = await escalate(orgId, request, `Stopped: the recovery for ${nounCode('run', run.id)} could not start — ${out.error}`, unblockFor(failure), failure);
    } else if (out.res.status === 'pending') {
      line = `${input.reason} It is on a card for a person (${nounCode('action', out.res.runId)}).`;
      await updateRecovery(orgId, requestId, s => logLine(s, line, now.toISOString(), run.id));
    } else if (out.res.outcome === 'already_underway') {
      // Nothing new started: say what is, never "sending it again" over no run.
      line = `${nounCode('run', run.id)} failed (${failure.sentence}); not sent again because ${out.res.underway?.line ?? 'another start is under way'}.`;
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
  await clearResolvedBlocker(orgId, request).catch(() => null);
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
  const decision = recoveryDecision({ failure, attempts: attemptsOf(fresh, 'plan'), limit: fresh.limit, planWhy });
  if (decision.do !== 'plan') {
    return { requestId: request.id, did: 'escalate', line: await escalate(orgId, request, decision.why, 'write the plan, or say the work does not need one, then press Build') };
  }
  const { noteAttempt } = await import('./recovery');
  const at = now.toISOString();
  await updateRecovery(orgId, request.id, s => noteAttempt(s, { at, kind: 'plan', trigger: 'recovery', runId: null, taskId: null, line: planWhy }));
  const { FACTORY_PLAN_REQUESTED, emitEvent } = await import('@/services/EventService');
  // The planner reads what stopped the last attempt, so it does not repeat it.
  await emitEvent({ orgId, type: FACTORY_PLAN_REQUESTED, payload: { requestId: request.id, title: request.title, why: `${planWhy}. The last attempt did not file a plan — ${why}. Do not repeat what stopped it` }, dedupeKey: `${FACTORY_PLAN_REQUESTED}:${request.id}:${at}`, invokedBy: `factory:${PM}`, dispatchMode: 'auto' });
  // What the page's Current state reads: that it is planning again, which
  // attempt this is, and why the last one stopped.
  const again = `Planning again (attempt ${attemptsOf(fresh, 'plan') + 1} of ${fresh.limit}) because ${why}.`;
  await updateRecovery(orgId, request.id, s => logLine({ ...s, line: again }, again, at));
  return { requestId: request.id, did: 'plan', line: `Recovered: planning again because ${why}.` };
}

/**
 * A STALE PLAN IS PLANNED AGAIN. The plan the failed run was built from is
 * superseded (it no longer counts as approved, so nothing builds from it),
 * and the build is dispatched as a recovery with the brief as its
 * `planFirst`: the dispatch finds no approved plan, plans, and the planner
 * reads why the last plan failed and which paths exist now. The planning
 * step counts as an attempt; the new plan's approval builds it.
 * @param orgId - Tenant.
 * @param opts - The facts.
 * @param opts.request - The request.
 * @param opts.runId - The failed run.
 * @param opts.planId - The stale plan, when there was one.
 * @param opts.why - The failure in a sentence.
 * @param opts.brief - The planner's brief (`replanBrief`).
 * @param opts.failure - The failure, for a stop if the dispatch is refused.
 * @param opts.now - The clock.
 * @returns The line written on the run.
 */
async function replanStale(orgId: string, opts: { request: FactoryRecord; runId: number; planId: number | null; why: string; brief: string; failure: Failure; now: Date }): Promise<string> {
  const { supersedePlan } = await lib();
  const at = opts.now.toISOString();
  if (opts.planId) {
    await supersedePlan(orgId, opts.planId, opts.why, at);
  }
  const reason = `Recovered: planning again because ${opts.why}${opts.planId ? `; ${await codeForRecord(orgId, opts.planId).catch(() => null) ?? `plan #${opts.planId}`} is superseded` : ''}.`;
  const out = await propose(orgId, DISPATCH, { requestId: opts.request.id, trigger: 'recovery', recoveryOfRun: opts.runId, recoveryClass: 'stale_plan', planFirst: opts.brief, reason }, {
    confidence: 0.9,
    rationale: `${nounCode('run', opts.runId)} failed because the plan no longer fits the repository: ${opts.why}. The same plan would fail the same way, so it is planned again.`,
    reason: 'One automatic planning step within the limit; Undo cancels it.',
  });
  if (!out.ok) {
    return escalate(orgId, opts.request, `Stopped: planning again for ${nounCode('run', opts.runId)} could not start — ${out.error}`, unblockFor(opts.failure), opts.failure);
  }
  if (out.res.status === 'pending') {
    const line = `${reason} It is on a card for a person (${nounCode('action', out.res.runId)}).`;
    await updateRecovery(orgId, opts.request.id, s => logLine(s, line, at, opts.runId));
    return line;
  }
  return reason;
}

/**
 * A STALE PLAN ANSWERS ITS OWN STOP. #130 stopped at 04:27 on 2026-09-29
 * (ask #223, "the last attempt made no changes … name what the change may
 * touch"): the worker that ran it said only "no changes", but plan #136
 * names `apps/send-api` and `apps/send-web`, which the repo record no longer
 * lists. For every open stop whose request's newest failed run was a stale
 * plan — typed by the worker (`paths_missing`, `out_of_bounds`), or a
 * "no changes" whose plan the records show is stale — the ask is superseded
 * and the request is planned again, once per failed run
 * (`meta.stalePlanReplannedFor`), within the attempt limit.
 * @param orgId - Tenant.
 * @param now - The clock.
 */
export async function replanStaleStops(orgId: string, now: Date = new Date()): Promise<CarryResult[]> {
  const { and, eq, like } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema } = await import('@/models/Schema');
  const stops = await db.select({ id: askSchema.id, sourceRef: askSchema.sourceRef }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, 'factory-recovery:%')));
  const { readRecord, writeMeta } = await lib();
  const { supersedeAsk } = await import('@/services/AskService');
  const out: CarryResult[] = [];
  for (const stop of stops) {
    const requestId = Number(/^factory-recovery:(\d+):/.exec(String(stop.sourceRef ?? ''))?.[1]);
    const request = Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
    if (!request || !(await carriedHere(orgId, request))) {
      continue;
    }
    const work = await workFor(orgId, requestId);
    const failed = work.runs[0];
    if (!failed || !['failed', 'lost'].includes(failed.status) || work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting || Number(request.meta.stalePlanReplannedFor) === failed.id) {
      continue;
    }
    const state = readRecovery(request.meta);
    if (attemptsOf(state, 'build') >= state.limit) {
      continue;
    }
    const task = work.tasks.find(t => String(t.id) === String((failed.input.record as Meta | undefined)?.id));
    const planId = Number(task?.meta.planId) > 0 ? Number(task!.meta.planId) : null;
    const typed = classifyFailure({ status: failed.status, error: failed.error, failures: failed.failures, result: failed.result });
    const stale = typed.class === 'stale_plan' ? typed.stale ?? null : typed.class === 'no_changes' ? await planStaleness(orgId, planId, request) : null;
    if (!stale) {
      continue;
    }
    const failure = typed.class === 'stale_plan' ? typed : staleFailure(stale);
    // Written before the dispatch, so a sweep that overlaps this one never plans twice.
    await writeMeta(orgId, requestId, { stalePlanReplannedFor: failed.id });
    const line = await replanStale(orgId, { request, runId: failed.id, planId, why: failure.sentence, brief: replanBrief(failure), failure, now });
    const at = now.toISOString();
    const fresh = readRecovery((await readRecord(orgId, requestId))?.meta);
    if (fresh.askId !== stop.id || fresh.stage !== 'stopped') {
      // The dispatch went through (it moved the request to planning): the stop is answered.
      await supersedeAsk(orgId, stop.id, `The plan was stale; planning again. ${line}`);
      await updateRecovery(orgId, requestId, s => logLine({ ...s, askId: s.askId === stop.id ? null : s.askId, stage: s.stage === 'stopped' ? null : s.stage, line: s.stage === 'stopped' ? null : s.line }, `${nounCode('ask', stop.id)} resolved itself: the plan was stale, and the factory is planning again.`, at, failed.id));
    }
    await recordRunLine(orgId, failed.id, line);
    out.push({ requestId, did: 'replan', line });
  }
  return out;
}

/**
 * A DEPLOY RESUMES A WORKFLOW'S STOP ONCE (Walk 12, 2026-10-03: FE-376
 * stopped on a QA gate core #1089 then removed, and kept waiting for a
 * person). `resumeAfterWorkerRebuild` below does this for the choreography,
 * which a request run by its workflow skips. A request whose workflow stopped
 * before the newest applied deploy is asked to build once more, by the event
 * its flow waits on, once per deploy; the flow gives a deploy's ask exactly
 * one attempt, so a stop that still fails stops again and waits for a person.
 * @param orgId - Tenant.
 * @param now - The clock.
 * @param opts - Overrides for tests.
 * @param opts.durable - Whether the factory runs as a workflow here; read from the workspace when absent.
 */
export async function resumeWorkflowStopsAfterDeploy(orgId: string, now: Date = new Date(), opts: { durable?: boolean } = {}): Promise<CarryResult[]> {
  const durable = opts.durable ?? await (await import('@/libs/durable/flags')).durableOn(orgId, 'factory');
  if (!durable) {
    return [];
  }
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { workspaceVersionSchema } = await import('@/models/Schema');
  const [applied] = await db.select({ id: workspaceVersionSchema.id, at: workspaceVersionSchema.appliedAt }).from(workspaceVersionSchema).where(and(eq(workspaceVersionSchema.orgId, orgId), eq(workspaceVersionSchema.status, 'applied'))).orderBy(desc(workspaceVersionSchema.id)).limit(1);
  if (!applied?.at || applied.at.getTime() > now.getTime()) {
    return [];
  }
  const version = `deploy ${applied.id}`;
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const { writeMeta } = await lib();
  const { emitEvent } = await import('@/services/EventService');
  const { BUILD_REQUESTED } = await import('./requestWorkflowStart');
  const out: CarryResult[] = [];
  for (const r of ((await listBusinessObjects(orgId, (await factoryTypes(orgId)).request).catch(() => [])) as Array<{ id: number; metadata: unknown }>)) {
    const meta = (r.metadata ?? {}) as Meta;
    const stoppedAt = Date.parse(String(meta.statusAt ?? ''));
    if (meta.status !== 'stopped' || meta.deployResumedFor === version || !Number.isFinite(stoppedAt) || stoppedAt >= applied.at.getTime()) {
      continue;
    }
    const line = `Vocion was deployed since the stop (${version}); one more attempt.`;
    const since = new Date(Date.now() - 1000).toISOString();
    await emitEvent({ orgId, type: BUILD_REQUESTED, payload: { requestId: r.id, by: 'system:factory-reconcile', byPerson: false, from: 'a deploy since the stop', trigger: 'recovery', afterDeploy: true, note: line, planId: null }, dedupeKey: `${BUILD_REQUESTED}:${r.id}:deploy:${applied.id}`, invokedBy: 'system:factory-reconcile' });
    await writeMeta(orgId, r.id, { deployResumedFor: version });
    // A run started on an older flow would read this ask under the old rules
    // (FE-419); at this safe point it is restarted on the current flow.
    const { restartRequestFlowIfChanged } = await import('./requestWorkflowStart');
    await restartRequestFlowIfChanged(orgId, r.id, since).catch(err => console.warn('factory: could not restart a stopped flow on the current definition', { orgId, requestId: r.id, message: (err as Error).message }));
    const askId = readRecovery(meta).askId;
    if (askId) {
      const { supersedeAsk } = await import('@/services/AskService');
      await supersedeAsk(orgId, askId, line).catch(() => undefined);
    }
    out.push({ requestId: r.id, did: 'resumed after a deploy', line });
  }
  return out;
}

/**
 * A NEW WORKER RETRIES EVERY STOP ONCE (2026-09-30). A worker deploy is new
 * capability: on 2026-09-30 the worker stopped fencing the engineer inside the
 * plan's paths (squatch-core #130), and four features sat "Stopped" for a
 * person although the thing that stopped them was gone. So any open stop, not
 * only an infrastructure one, is built again once per new worker version,
 * carrying why it stopped; it stops again, with its reason, if it fails again.
 *
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
  const stops: Array<{ id: number | null; sourceRef: string | null; createdAt: Date | null }> = await db.select({ id: askSchema.id, sourceRef: askSchema.sourceRef, createdAt: askSchema.createdAt }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, 'factory-recovery:%')));
  // A STOP WHOSE ASK IS CLOSED IS STILL A STOP (2026-09-30, "Open alerts"
  // #124: its ask #220 was decided on 09-28, the request stayed "Stopped",
  // and nothing would ever look at it again). Such a request joins the stops,
  // dated by its last recovery line.
  const withOpenAsk = new Set(stops.map(st => Number(/^factory-recovery:(\d+):/.exec(String(st.sourceRef ?? ''))?.[1])));
  const { listBusinessObjects: listRequests } = await import('@/services/BusinessObjectService');
  for (const r of ((await listRequests(orgId, (await factoryTypes(orgId)).request).catch(() => [])) as Array<{ id: number; metadata: unknown }>)) {
    const state = readRecovery((r.metadata ?? {}) as Meta);
    if (state.stage === 'stopped' && !withOpenAsk.has(r.id)) {
      const last = state.log.at(-1)?.at;
      stops.push({ id: null, sourceRef: `factory-recovery:${r.id}:closed-ask`, createdAt: last ? new Date(last) : null });
    }
  }
  if (stops.length === 0) {
    return [];
  }
  const oldest = new Date(Math.min(...stops.map(a => (a.createdAt ?? now).getTime())));
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const environments = ((await listBusinessObjects(orgId, (await factoryTypes(orgId)).environment).catch(() => [])) as Array<{ title: string; metadata: unknown }>)
    .map(r => (r.metadata ?? {}) as Meta)
    .filter(m => m.surface === 'worker' || /worker/i.test(String(m.slug ?? '')))
    .map(m => ({ slug: String(m.slug ?? 'worker'), lastDeployedAt: typeof m.lastDeployedAt === 'string' ? m.lastDeployedAt : null, lastDeployedSha: typeof m.lastDeployedSha === 'string' ? m.lastDeployedSha : null }));
  const reported = (await db.select({ v: workerRunSchema.workerVersion, at: workerRunSchema.claimedAt }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), isNotNull(workerRunSchema.workerVersion), gt(workerRunSchema.claimedAt, oldest))).orderBy(desc(workerRunSchema.id)).limit(20))
    .flatMap(r => (r.v && r.at ? [{ version: r.v, at: r.at }] : []));
  // A DEPLOY IS NEW CAPABILITY TOO (2026-09-30, #201: its stop was a bad repo
  // in the contract; the fix shipped in core, not in the worker, and the stop
  // waited for a worker rebuild that would never come). Every deploy applies
  // the workspace, so the newest applied version stands for "the platform
  // changed since the stop", and it resumes each stop once, the same as a new
  // worker does.
  const { workspaceVersionSchema } = await import('@/models/Schema');
  const [applied] = await db.select({ id: workspaceVersionSchema.id, at: workspaceVersionSchema.appliedAt }).from(workspaceVersionSchema).where(and(eq(workspaceVersionSchema.orgId, orgId), eq(workspaceVersionSchema.status, 'applied'))).orderBy(desc(workspaceVersionSchema.id)).limit(1);
  const { readRecord, writeMeta } = await lib();
  const { supersedeAsk } = await import('@/services/AskService');
  const out: CarryResult[] = [];
  for (const stop of stops) {
    const requestId = Number(/^factory-recovery:(\d+):/.exec(String(stop.sourceRef ?? ''))?.[1]);
    const request = Number.isInteger(requestId) && requestId > 0 ? await readRecord(orgId, requestId) : null;
    if (!request || !(await carriedHere(orgId, request))) {
      continue;
    }
    // A stop on a check command waits for the repo record, not for a worker or a deploy (`resumeAfterCheckFix`).
    if (request.meta.checkConfigStop) {
      continue;
    }
    const work = await workFor(orgId, requestId);
    // A stop with no run behind it (#233: the plan approved, the count spent
    // before a build ever started) is resumed too, from its approved plan.
    const failed = work.runs[0] ?? null;
    if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting) {
      continue;
    }
    const failure = failed
      ? classifyFailure({ status: failed.status, error: failed.error, failures: failed.failures })
      : { class: 'no_run', sentence: 'the build never started' };
    const deployedSince = applied?.at && applied.at.getTime() > (stop.createdAt ?? now).getTime()
      ? { version: `deploy ${applied.id}`, source: 'deploy' as const }
      : null;
    const rebuilt = workerRebuiltSince({ stoppedAt: stop.createdAt ?? now, failedVersion: failed?.workerVersion ?? null, environments, reported }) ?? deployedSince;
    if (!rebuilt || request.meta.workerRebuildResumedFor === rebuilt.version) {
      continue;
    }
    const line = rebuilt.source === 'deploy'
      ? `Vocion was deployed since the stop (${rebuilt.version}); building again.`
      : `New worker (${rebuilt.version}) since the stop; building again.`;
    // A new worker starts a new count: the attempts it is retrying were made
    // by the old one (#246 read "Recovering (attempt 4 of 3)" after the resume).
    await updateRecovery(orgId, requestId, s => ({ ...s, attempts: [], since: now.toISOString() }));
    const task = failed ? work.tasks.find(t => String(t.id) === String((failed.input.record as Meta | undefined)?.id)) : undefined;
    const planId = Number(task?.meta.planId) > 0 ? Number(task!.meta.planId) : (await approvedPlan(work.plans))?.id;
    const dispatched = await propose(orgId, DISPATCH, { requestId, ...(planId ? { planId } : {}), trigger: 'recovery', ...(failed ? { recoveryOfRun: failed.id } : {}), recoveryClass: failure.class, reason: line }, {
      confidence: 0.9,
      rationale: `${failed ? nounCode('run', failed.id) : `Request #${requestId}`} stopped (${failure.sentence}); ${rebuilt.source === 'deploy' ? `Vocion was deployed after the stop (${rebuilt.version})` : `a new worker was deployed after the stop (${rebuilt.version}, ${rebuilt.source === 'environment' ? 'its environment record' : 'a run reported it'})`}.`,
      reason: 'There is a new worker since the stop, so it gets one more attempt; Undo cancels it until a worker claims it.',
    });
    const at = now.toISOString();
    if (!dispatched.ok) {
      // The stop stays open, and says why the rebuild did not carry it on.
      await updateRecovery(orgId, requestId, s => logLine(s, `Worker rebuilt (${rebuilt.version}), but the build could not start: ${dispatched.error}`, at));
      out.push({ requestId, did: 'rebuilt:refused', line: dispatched.error });
      continue;
    }
    await writeMeta(orgId, requestId, { workerRebuildResumedFor: rebuilt.version });
    if (stop.id !== null) {
      await supersedeAsk(orgId, stop.id, line);
    }
    await updateRecovery(orgId, requestId, s => logLine({ ...s, stage: s.stage === 'stopped' ? null : s.stage, askId: s.askId === stop.id ? null : s.askId, line: s.stage === 'stopped' ? null : s.line }, `${line}${stop.id !== null ? ` ${nounCode('ask', stop.id)} resolved itself.` : ''}${dispatched.res.status === 'pending' ? ` The build is on a card for a person (${nounCode('action', dispatched.res.runId)}).` : ''}`, at, failed?.id ?? null));
    if (failed) {
      await recordRunLine(orgId, failed.id, line);
    }
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
  const requests = ((await listBusinessObjects(orgId, (await factoryTypes(orgId)).request).catch(() => [])) as Array<{ id: number }>).map(r => r.id).sort((a, b) => a - b);
  // A stop a stale plan explains is planned again first: a new plan, not a
  // new build, is what answers it.
  const acted: CarryResult[] = await replanStaleStops(orgId, now).catch((err: Error) => {
    console.warn('factory sweep: the stale-plan check failed', { orgId, message: err.message });
    return [];
  });
  // A task waiting on QA with no review behind it is watched every five
  // minutes by the reconciler (`reconcile.ts`, backlog 049), not here.
  // A replaced attempt's pull request is closed, naming what replaced it, so
  // the open PRs are the work still live (services/factory/supersededPulls.ts).
  await import('./supersededPulls').then(m => m.closeSupersededPulls(orgId)).catch((err: Error) => {
    console.warn('factory sweep: closing superseded pull requests failed', { orgId, message: err.message });
  });
  // Then every other stop a new worker has arrived since is built again once,
  // so the requests it carried on are not read as stuck below.
  acted.push(...await resumeAfterWorkerRebuild(orgId, now).catch((err: Error) => {
    console.warn('factory sweep: the worker-rebuild check failed', { orgId, message: err.message });
    return [];
  }));
  // A request one of those just carried on is not read again in this sweep:
  // its planning started a moment ago, and nothing has picked it up yet.
  const carried = new Set(acted.map(a => a.requestId));
  for (const id of requests) {
    if (acted.length >= limit) {
      break;
    }
    if (carried.has(id)) {
      continue;
    }
    const request = await readRecord(orgId, id);
    if (!request || !(await carriedHere(orgId, request))) {
      continue;
    }
    const state = readRecovery(request.meta);
    const work = await workFor(orgId, id);
    // A blocker whose move was made elsewhere (an ask answered, a card
    // decided) is cleared here, within the hour.
    const cleared = await clearResolvedBlocker(orgId, request, work.plans, now).catch(() => null);
    if (cleared) {
      acted.push({ requestId: id, did: 'blocker cleared', line: cleared });
    }
    if (work.runs.some(r => LIVE_RUN.has(r.status)) || work.waiting || work.openAsks.length > 0) {
      continue;
    }
    // A stop on a check that could not run continues once its command is fixed.
    if (state.stage === 'stopped' && request.meta.checkConfigStop) {
      const r = await resumeAfterCheckFix(orgId, request, now).catch((err: Error) => {
        console.warn('factory sweep: the check-fix check failed', { orgId, requestId: id, message: err.message });
        return null;
      });
      if (r) {
        acted.push(r);
      }
      continue;
    }
    // A REQUEST INTAKE COULD NOT START IS CARRIED ON (2026-10-01, #294).
    if (!state.stage && work.tasks.length === 0 && work.runs.length === 0) {
      const r = await carryStalledIntake(orgId, request, work.plans.length > 0, now).catch((err: Error) => {
        console.warn('factory sweep: carrying a stalled intake failed', { orgId, requestId: id, message: err.message });
        return null;
      });
      if (r) {
        if (r.line) {
          acted.push(r);
        }
        continue;
      }
    }
    if (state.stage === 'planning') {
      const r = await carryPlanningStage(orgId, request, state, work, now);
      if (r) {
        acted.push(r);
      }
      continue;
    }
    // AN APPROVED PLAN NOTHING WAS BUILT FROM IS BUILT (2026-09-30, #201:
    // plan #254 approved, its build refused by a guard, and the request sat
    // with no stage and nothing running). The newest approved plan with no
    // task created since its approval starts its build.
    const plan = await approvedPlan(work.plans);
    if (plan && state.stage !== 'stopped' && !work.tasks.some(t => (t.createdAt?.getTime() ?? 0) >= (plan.createdAt?.getTime() ?? 0))) {
      const r = await buildFromApprovedPlan(orgId, { planId: plan.id, requestId: id, approvedBy: String(plan.meta.approvedBy ?? 'a person'), byPerson: false });
      acted.push(r);
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

/** How long after filing a request intake never started is tried again. */
export const INTAKE_RETRY_AFTER_MS = 10 * 60_000;
/** How long between tries. */
const INTAKE_RETRY_EVERY_MS = 30 * 60_000;
/** How many times intake reads one request before it is left to a person's Build. */
const INTAKE_TRIES = 3;
/** How far back a request a person asked for is still carried on by itself. */
const INTAKE_RETRY_WINDOW_MS = 3 * 24 * 60 * 60_000;

/**
 * A REQUEST INTAKE COULD NOT START, CARRIED ON BY THE SWEEP (2026-10-01,
 * #294: the dispatch refused, intake said "no card", and nothing read the
 * request again). Two shapes, both read from typed fields, never from words:
 *
 *   blocked   intake left a blocker with its cause (`unreadyBlocker`). The
 *             records are read again; once they say it can be built, the
 *             blocker clears, its account says so, and intake runs again.
 *   stalled   a person's request (its `origin`) that intake marked refused,
 *             or that carries no mark at all (filed before marks existed),
 *             with nothing built, planned or waiting. Intake runs again, a
 *             few times, each a while apart, as the person's action: the
 *             person's hold, if they said one, is read again by the model.
 *
 * Null when neither applies, so the sweep carries on with its other checks.
 * @param orgId - Tenant.
 * @param request - The request (open, nothing live, no stage, no tasks).
 * @param planned - Whether it has any plan.
 * @param now - The clock.
 */
async function carryStalledIntake(orgId: string, request: FactoryRecord, planned: boolean, now: Date): Promise<CarryResult | null> {
  const id = request.id;
  const mark = readIntake(request.meta);
  const blocker = request.meta.blocker && typeof request.meta.blocker === 'object' ? request.meta.blocker as Meta : null;
  const origin = request.meta.origin && typeof request.meta.origin === 'object' ? request.meta.origin as Meta : null;
  // As the filing said it: the mark's own record of who filed it, else the request's origin.
  const from = mark?.from ?? { conversationId: typeof origin?.conversationId === 'number' ? origin.conversationId : null, byPerson: typeof origin?.userId === 'string', actor: typeof origin?.userId === 'string' ? origin.userId : null };
  const payload = { objectId: id, objectType: (await factoryTypes(orgId)).request, conversationId: from.conversationId, byPerson: from.byPerson, ...(from.actor ? { actor: from.actor } : {}) } as Partial<ObjectCreatedPayload>;
  if (mark?.outcome === 'blocked' && blocker && typeof blocker.cause === 'string') {
    // Filed under the wrong record is the commonest reason for "no repo":
    // the person's words are read again before the records are.
    await correctReference(orgId, request, payload);
    const readiness = await readinessOf(orgId, id, null);
    if (!readiness.ready && readiness.cause === blocker.cause) {
      return { requestId: id, did: 'still blocked', line: null };
    }
    const { writeMeta } = await lib();
    await writeMeta(orgId, id, { blocker: null });
    const line = readiness.ready ? `The blocker cleared: it can be built now${readiness.repo ? ` from ${readiness.repo}` : ''}.` : 'The blocker changed; intake reads it again.';
    await updateRecovery(orgId, id, s => logLine(s, line, now.toISOString()));
    const r = await intakeFiledRequest(orgId, payload, { retry: true });
    return { requestId: id, did: `unblocked:${r.did}`, line: r.line ?? line };
  }
  if (planned || blocker || !from.byPerson) {
    return null;
  }
  if (mark && mark.outcome !== 'refused') {
    return null;
  }
  const filedAt = typeof origin?.at === 'string' ? Date.parse(origin.at) : mark ? Date.parse(mark.at) : Number.NaN;
  if (!Number.isFinite(filedAt) || now.getTime() - filedAt < INTAKE_RETRY_AFTER_MS || now.getTime() - filedAt > INTAKE_RETRY_WINDOW_MS) {
    return null;
  }
  if (mark && (mark.tries >= INTAKE_TRIES || now.getTime() - Date.parse(mark.at) < INTAKE_RETRY_EVERY_MS)) {
    return null;
  }
  const r = await intakeFiledRequest(orgId, payload, { retry: true });
  return { requestId: id, did: `intake again:${r.did}`, line: r.line };
}

/**
 * A REQUEST AT PLANNING, CARRIED ON. Shared by the hourly sweep and by the
 * moment the planning run ends (`planningRunEnded`), so a planner that ends
 * without a plan is caught when it ends, not up to an hour later (request
 * #246, 2026-09-29: the plan was refused, the run ended "completed", and the
 * page said "Planning" with nothing behind it; Chris: "Why was there no
 * visibility to why or way through? … The system isn't smart enough to heal
 * or recover without my direct intervention.").
 * @param orgId - Tenant.
 * @param request - The request.
 * @param state - Its recovery state.
 * @param work - Its plans, runs and asks.
 * @param now - The clock.
 */
async function carryPlanningStage(orgId: string, request: FactoryRecord, state: RecoveryState, work: Awaited<ReturnType<typeof workFor>>, now: Date): Promise<CarryResult | null> {
  const id = request.id;
  const plan = await approvedPlan(work.plans);
  if (plan) {
    return buildFromApprovedPlan(orgId, { planId: plan.id, requestId: id, approvedBy: String(plan.meta.approvedBy ?? 'a person'), byPerson: false });
  }
  const asked = state.planRequestedAt ? Date.parse(state.planRequestedAt) : Number.NaN;
  // A PLANNING RUN THAT ENDED WITHOUT A PLAN IS A FAILED STEP, not
  // "already planning" (#201, mission 6017: it read the request and
  // proposed an approval for a plan it never filed). It counts toward the
  // limit: plan again, with what stopped it, or stop and ask.
  const filedSince = work.plans.some(p => !['rejected', 'superseded'].includes(String(p.meta.status ?? '')) && (p.createdAt?.getTime() ?? 0) >= asked - 1000);
  const ended = !filedSince && state.planRequestedAt ? await planningEnded(orgId, id, state.planRequestedAt) : null;
  if (ended) {
    return replan(orgId, request, state, ended.why, now);
  }
  // QUIET PLANNING IS FAILED PLANNING (2026-09-30, #130: planning asked for at
  // 16:53, the run ended "ok" having filed nothing, and the page read
  // "Planning" for eleven hours; the day-old check below only looked at
  // requests with no plan at all, and #130 had an old rejected one). Nothing
  // filed since the ask, well past any planning run: plan again with that
  // reason, which stops and asks once the planning budget is spent.
  if (!filedSince && Number.isFinite(asked) && now.getTime() - asked > PLAN_QUIET_MS) {
    return replan(orgId, request, state, 'the planning run ended without filing a plan', now);
  }
  if (work.plans.length === 0 && Number.isFinite(asked) && now.getTime() - asked > PLAN_STALE_MS) {
    return { requestId: id, did: 'escalate', line: await escalate(orgId, request, 'Stopped: a plan was asked for a day ago and none was written', 'write the plan, or say the work does not need one') };
  }
  return null;
}

/**
 * The planning run for a request ended (`automation_run.completed` of the
 * plan-request automation): carry the request on now — build from its
 * approved plan, or plan again with what stopped the last attempt.
 * @param orgId - Tenant.
 * @param payload - The event payload (`automationRunId`).
 */
export async function planningRunEnded(orgId: string, payload: Record<string, unknown>): Promise<CarryResult> {
  const runId = Number(payload.automationRunId);
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema } = await import('@/models/Schema');
  const [run] = Number.isInteger(runId) && runId > 0
    ? await db.select({ input: automationRunSchema.input }).from(automationRunSchema).where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.id, runId))).limit(1)
    : [];
  const requestId = Number((run?.input as { requestId?: unknown } | null)?.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return skip(null, 'no request on the run');
  }
  const request = await (await lib()).readRecord(orgId, requestId);
  if (!request || !(await carriedHere(orgId, request))) {
    return skip(requestId, 'request closed');
  }
  const state = readRecovery(request.meta);
  if (state.stage !== 'planning') {
    return skip(requestId, 'not planning');
  }
  const r = await carryPlanningStage(orgId, request, state, await workFor(orgId, requestId), new Date());
  return r ?? skip(requestId, 'planning still running, or a plan was filed');
}

/**
 * Which of a write's fields are the contract, as the automation that runs this
 * job says (`input.contractFields`, beside its `when.filter.fieldsAny`) — the
 * plugin decides what a contract is, never a list here. Without the list, the
 * automation's filter already chose, and every field the write changed counts.
 * @param payload - The job's input: the `object.updated` payload with the automation's `input`.
 */
function contractFieldsOf(payload: Record<string, unknown>): string[] {
  const fields = String(payload.fields ?? '').split(',').map(f => f.trim()).filter(Boolean);
  const contract = Array.isArray(payload.contractFields) ? payload.contractFields.map(String) : null;
  return contract ? fields.filter(f => contract.includes(f)) : fields;
}

/**
 * Whether a write of these fields on a record of this type is one the
 * contract-changed automation hears — read off the workspace's own automation
 * (its `when.filter`), so the chat's receipt and the job agree on what a
 * contract change is.
 * @param orgId - The workspace.
 * @param objectType - The record's type slug.
 * @param fields - The fields written.
 */
export async function contractChangeHeard(orgId: string, objectType: string, fields: readonly string[]): Promise<boolean> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationSchema } = await import('@/models/Schema');
  const { matchesFilter } = await import('@/services/eventFilter');
  const { FACTORY_CONTRACT_CHANGED_JOB } = await import('@/services/jobs/factoryCarry');
  const rows = await db.select({ whenConfig: automationSchema.whenConfig, doConfig: automationSchema.doConfig }).from(automationSchema).where(and(
    eq(automationSchema.orgId, orgId),
    eq(automationSchema.status, 'active'),
    sql`${automationSchema.doConfig} ->> 'job' = ${FACTORY_CONTRACT_CHANGED_JOB}`,
  ));
  const payload = { objectType, fields: [...fields].sort().join(',') };
  return rows.some((r) => {
    const input = ((r.doConfig ?? {}) as { input?: Record<string, unknown> }).input ?? {};
    return matchesFilter(payload, r.whenConfig.filter) && contractFieldsOf({ ...payload, ...input }).length > 0;
  });
}

/**
 * THE CONTRACT CHANGED AFTER QA — back through the loop (Chris, 2026-09-29, on
 * #201 waiting at "Review the merge": "I wanted from chat to expand the
 * requirements and send it back to the plan/build/qa loop"). When a request's
 * contract is written while one of its tasks waits to merge, that merge is held
 * with the reason (the task goes back to Changes asked), and the next attempt
 * starts on its own against the new contract — continuing the pull request's
 * branch (`pickResumeBase`), so QA judges every criterion again.
 * @param orgId - The workspace.
 * @param payload - The `object.updated` payload.
 */
export async function reopenForContractChange(orgId: string, payload: Record<string, unknown>): Promise<CarryResult> {
  const requestId = Number(payload.objectId);
  const changed = contractFieldsOf(payload);
  if (!Number.isInteger(requestId) || requestId <= 0 || changed.length === 0) {
    return skip(Number.isInteger(requestId) ? requestId : null, 'no contract field changed');
  }
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const work = await workFor(orgId, requestId);
  const taskIds = work.tasks.map(t => t.id);
  if (taskIds.length === 0) {
    return skip(requestId, 'no task to reopen');
  }
  const pending = (await db.select({ id: actionRunSchema.id, input: actionRunSchema.input }).from(actionRunSchema).where(and(
    eq(actionRunSchema.orgId, orgId),
    eq(actionRunSchema.actionId, 'git.merge'),
    inArray(actionRunSchema.status, ['pending', 'awaiting_execution']),
  ))).filter(r => taskIds.includes(Number((r.input as { taskId?: unknown } | null)?.taskId)));
  if (pending.length === 0) {
    // No merge waiting: the next Build already builds to the new contract.
    return skip(requestId, 'no merge waiting');
  }
  const by = typeof payload.actor === 'string' && payload.actor ? payload.actor : 'factory';
  const why = `The request's ${changed.join(', ')} changed after QA approved; it goes back for another attempt against the new contract.`;
  const { rejectAction, proposeAction } = await import('@/services/ActionService');
  for (const run of pending) {
    // Its onRejected holds the task (Changes asked) with this reason as the note.
    await rejectAction(run.id, orgId, why, { reviewedBy: by });
  }
  const held = work.tasks.find(t => pending.some(r => Number((r.input as { taskId?: unknown }).taskId) === t.id));
  const planId = Number(held?.meta.planId);
  const res = await proposeAction({
    orgId,
    actionId: 'factory.dispatch_task',
    input: {
      requestId,
      // The plan was made against the old contract, so it is planned again: plan → build → QA.
      ...(Number.isFinite(planId) && planId > 0
        ? { planId, replan: `the request's contract changed after QA approved (${changed.join(', ')}); plan against the new acceptance` }
        : {}),
      trigger: 'recovery',
      recoveryClass: 'contract_changed',
      // One reopen per held attempt: the attempt's run keys it.
      ...(Number(held?.meta.workerRunId) > 0 ? { recoveryOfRun: Number(held?.meta.workerRunId) } : {}),
      note: `The contract changed after QA approved (${changed.join(', ')}). Continue the branch: keep what is proven, meet the new acceptance, and prove every criterion again.`,
      reason: why,
    },
    principal: { kind: 'agent', id: 'agent:product-manager', scope: { orgId }, grants: ['*'], autonomy: 2 },
    invokedBy: 'factory:product-manager',
    internal: true,
    proposal: { confidence: 0.9, rationale: why, agentSlug: 'product-manager', suggestedDecision: 'approve', suggestedDecisionReason: 'The contract a person just changed is what the next attempt builds to.' },
  }) as { runId: number; status: string };
  const line = `Contract changed after QA (${changed.join(', ')}): held the merge and ${res.status === 'pending' ? `put the next attempt on a card (${nounCode('action', res.runId)})` : `started the next attempt (${nounCode('action', res.runId)})`}.`;
  await updateRecovery(orgId, requestId, s => logLine(s, line, new Date().toISOString()));
  return { requestId, did: 'reopen', line };
}

/**
 * WHAT A CONTRACT CHANGE STARTED, for the write that made it. Conversation
 * 382's replay (2026-09-29): update_object widened request #201, the job
 * above held the merge and started the next attempt three seconds later —
 * and the agent, which never heard, answered "Ready to dispatch as soon as
 * you confirm." The tool now waits briefly for the job's receipt and says it,
 * so the answer describes what happened rather than offering to do it.
 *
 * Null at once when no merge was waiting (nothing to reopen), and null when
 * the job has not landed within `waitMs` — the write's own receipt stands.
 * @param orgId - The workspace.
 * @param requestId - The request whose contract changed.
 * @param since - When the write ran.
 * @param waitMs - How long to wait for the job.
 */
export async function contractChangeReceipt(orgId: string, requestId: number, since: Date, waitMs = 8_000): Promise<string | null> {
  const { and, eq, gte, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const work = await workFor(orgId, requestId);
  const taskIds = work.tasks.map(t => t.id);
  if (taskIds.length === 0) {
    return null;
  }
  const merges = async () => (await db.select({ id: actionRunSchema.id, status: actionRunSchema.status, input: actionRunSchema.input, decidedAt: actionRunSchema.decidedAt }).from(actionRunSchema).where(and(
    eq(actionRunSchema.orgId, orgId),
    eq(actionRunSchema.actionId, 'git.merge'),
    inArray(actionRunSchema.status, ['pending', 'awaiting_execution', 'rejected']),
  ))).filter(r => taskIds.includes(Number((r.input as { taskId?: unknown } | null)?.taskId))
    && (r.status !== 'rejected' || (r.decidedAt !== null && r.decidedAt >= since)));
  if ((await merges()).length === 0) {
    return null;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const [dispatch] = await db.select({ id: actionRunSchema.id, status: actionRunSchema.status }).from(actionRunSchema).where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'factory.dispatch_task'),
      gte(actionRunSchema.createdAt, since),
      sql`${actionRunSchema.input}->>'recoveryClass' = 'contract_changed'`,
      sql`(${actionRunSchema.input}->>'requestId')::int = ${requestId}`,
    )).limit(1);
    if (dispatch) {
      const held = (await merges()).filter(r => r.status === 'rejected').map(r => nounCode('action', r.id));
      const started = dispatch.status === 'done' ? 'started' : `filed (${nounCode('action', dispatch.id)} is ${dispatch.status})`;
      return `Because the contract changed while its merge waited, the factory already acted: ${held.length > 0 ? `merge ${held.join(', ')} is held and ` : ''}the next attempt is ${started} (${nounCode('action', dispatch.id)}) — plan again, build, then QA against the new acceptance. Nothing is left to dispatch or confirm; say that this is under way.`;
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  return null;
}

/**
 * Whether filing this type starts the factory's intake here: an active
 * automation runs the intake job on `object.created` for it.
 * @param orgId - The workspace.
 * @param objectType - The filed record's type slug.
 */
async function intakeHeard(orgId: string, objectType: string): Promise<boolean> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationSchema } = await import('@/models/Schema');
  const { matchesFilter } = await import('@/services/eventFilter');
  const { FACTORY_INTAKE_JOB } = await import('@/services/jobs/factoryCarry');
  const rows = await db.select({ whenConfig: automationSchema.whenConfig }).from(automationSchema).where(and(
    eq(automationSchema.orgId, orgId),
    eq(automationSchema.status, 'active'),
    sql`${automationSchema.doConfig} ->> 'job' = ${FACTORY_INTAKE_JOB}`,
  ));
  return rows.some(r => matchesFilter({ objectType }, r.whenConfig.filter));
}

/**
 * WHAT FILING STARTED, for the filing's own answer (run 2, 2026-10-01). A
 * person's request builds by default: intake started FE-298's build as the
 * person's action 1.7 s after it was filed, and the PM, which never heard,
 * answered "Here's the dispatch card" about a card that did not exist. The
 * filing tool now waits briefly for intake's typed mark (`readIntake`) and
 * says what it did, so the answer describes what happened rather than
 * offering to do it. The agent's words are its own; this is what it is told.
 *
 * Null at once when the type has no intake here, and null when intake has
 * not marked the record within `waitMs`: the filing's own receipt stands.
 * @param orgId - The workspace.
 * @param record - The record just filed.
 * @param record.objectType - Its type slug.
 * @param record.id - Its id.
 * @param waitMs - How long to wait for intake.
 * @param settleMs - How long to wait after the mark for the lines it writes next (planning first, the dispatch).
 */
export async function filingReceipt(orgId: string, record: { objectType: string; id: number }, waitMs = 8_000, settleMs = 1_500): Promise<string | null> {
  if (record.objectType !== (await factoryTypes(orgId)).request || !(await intakeHeard(orgId, record.objectType))) {
    return null;
  }
  const { readRecord } = await lib();
  const deadline = Date.now() + waitMs;
  let mark: IntakeMark | null = null;
  while (Date.now() < deadline) {
    mark = readIntake((await readRecord(orgId, record.id))?.meta ?? {});
    if (mark) {
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!mark) {
    return null;
  }
  if (mark.outcome === 'started' || mark.outcome === 'planning') {
    await new Promise(r => setTimeout(r, settleMs));
  }
  const fresh = await readRecord(orgId, record.id);
  const lines = readRecovery(fresh?.meta ?? {}).log.map(l => l.text.trim()).filter(Boolean).slice(-4);
  const said = lines.length > 0 ? ` What the request says: ${lines.map(l => `"${l}"`).join(' ')}` : '';
  switch (mark.outcome) {
    case 'started':
    case 'planning':
      return `The factory already acted on it: the build started as the person's own action, because they asked for it (Undo on the request cancels it until a worker claims it).${said} There is no card and nothing is left to dispatch or confirm: say it has started and what happens next, and link the request.`;
    case 'card':
      return `The build did not start on its own: a Build card is waiting for a person to approve.${said} Say that in one line, with the request's link.`;
    case 'held':
      return `Held, as the person asked: nothing is building, and the Build card waits for them.${said} Say that in one line.`;
    case 'blocked':
    case 'refused':
      return `The build could not start yet${mark.why ? `: ${mark.why}` : ''}.${said} Say what holds it and who it waits on, in one line, with the request's link.`;
    default:
      return null;
  }
}
