import type { TokenUsage } from '@/libs/pricing';
import type { WORKER_RUN_COMPLETED, WORKER_RUN_FAILED, WorkerRunEndedPayload } from '@/services/EventService';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { boundProgress } from '@/libs/worker/progress';
import { businessObjectSchema, businessObjectTypeSchema, workerRunSchema } from '@/models/Schema';
import { signClaim } from '@/services/agents/claims';
import { chargeUsage, preflightCheck } from '@/services/BudgetService';
import { recomputeRollups } from '@/services/objects/rollups';
import { assertWorkspaceRunning } from '@/services/workspacePause';

/**
 * WorkerRunService — the control plane for long-running agent runs that execute
 * OUTSIDE the app (ADR 0004, phase 1).
 *
 * The protocol, from the worker's side:
 *   1. someone creates a run (API, or an agent whose `harness.runsOn` is
 *      `external-worker`) — status `queued`
 *   2. the worker `claim`s it with its own id — status `running`, a lease starts,
 *      and it receives a short-lived TenantClaim for `/api/internal/agent-tools`
 *   3. it `heartbeat`s inside the lease, reporting progress and cost; the reply
 *      carries the control signals (stop, deadline, cap remaining) and a fresh claim
 *   4. it `complete`s or `fail`s. A lease that lapses is `reap`ed to `lost`.
 *
 * Vocion never hosts the worker and never sees its working state. Every write
 * here is scoped by orgId; every worker-side call must also present the
 * workerId that holds the lease.
 *
 * A run queued FOR A RECORD — `input.record = {type, id}`, an object of a type
 * the org has applied — writes its cost onto that record when it ends
 * ({@link writeBackRunCost}): the record IS the durable thing a person reads,
 * the run is the lease underneath it, and what the work cost belongs on the
 * record. Rollups the org's object types declare are recomputed from there.
 */

export type WorkerRunStatus = 'queued' | 'running' | 'paused' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled' | 'lost';

/**
 * What sort of run a row records — the axis the team report groups and
 * badges by. `worker` is the default and what every pre-0092 row means.
 */
export const WORKER_RUN_KINDS = ['lead', 'board', 'worker', 'red-team', 'compact', 'snapshot'] as const;
export type WorkerRunKind = typeof WORKER_RUN_KINDS[number];

/**
 * Narrow a caller-supplied kind; anything unknown is refused rather than
 * stored, so the report's badges never meet a spelling it does not know.
 * @param raw - Whatever the body carried.
 */
export function parseWorkerRunKind(raw: unknown): WorkerRunKind | null {
  return typeof raw === 'string' && (WORKER_RUN_KINDS as readonly string[]).includes(raw) ? raw as WorkerRunKind : null;
}

export type WorkerRun = typeof workerRunSchema.$inferSelect;

/** Errors the API maps 1:1 onto HTTP — the code names the situation, the status the response. */
export class WorkerRunError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'BUDGET_EXCEEDED' | 'DISABLED',
    message: string,
    public readonly status: 404 | 409 | 403 | 402 | 501,
  ) {
    super(message);
    this.name = 'WorkerRunError';
  }
}

const MAX_FAILURES = 50;
const CLAIM_GRACE_MS = 60_000;

/** Feature flag — phase 1 ships dark. `VOCION_EXTERNAL_WORKERS=1` turns it on. */
export function externalWorkersEnabled(): boolean {
  return process.env.VOCION_EXTERNAL_WORKERS === '1';
}

/**
 * Throw the 501 the routes return when the feature is off.
 */
export function assertExternalWorkersEnabled(): void {
  if (!externalWorkersEnabled()) {
    throw new WorkerRunError('DISABLED', 'External workers are not enabled on this deployment (set VOCION_EXTERNAL_WORKERS=1).', 501);
  }
}

/**
 * Sign the tool-call credential a worker presents to `/api/internal/agent-tools`.
 * Lifetime = the lease plus a grace, so a worker that heartbeats on time is never
 * caught with an expired claim mid-call.
 * @param run - The run the claim is for.
 */
function toolClaimFor(run: WorkerRun): string {
  return signClaim({
    orgId: run.orgId,
    agentSlug: run.agentSlug,
    userId: run.createdBy ?? undefined,
    exp: Date.now() + run.leaseSeconds * 1000 + CLAIM_GRACE_MS,
  });
}

/**
 * Queue a run for a worker to pick up.
 * @param opts - Run definition.
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.input
 * @param opts.endsAt
 * @param opts.capCents
 * @param opts.leaseSeconds
 * @param opts.createdBy
 * @param opts.workspaceSha
 * @param opts.kind - What sort of run; defaults to `worker`.
 * @param opts.model - The model expected to do the work; a heartbeat's `usage.model` overrides it.
 */
export async function createWorkerRun(opts: {
  orgId: string;
  agentSlug: string;
  input?: Record<string, unknown>;
  endsAt?: Date | null;
  capCents?: number | null;
  leaseSeconds?: number;
  createdBy?: string;
  workspaceSha?: string | null;
  kind?: WorkerRunKind;
  model?: string | null;
}): Promise<WorkerRun> {
  // Queueing is where a paused workspace stops a worker run: the queue is the
  // factory's intake, and a run added to it while the switch is off would sit
  // there waiting to start the moment someone resumed.
  await assertWorkspaceRunning(opts.orgId, 'worker_run');
  const [row] = await db.insert(workerRunSchema).values({
    orgId: opts.orgId,
    agentSlug: opts.agentSlug,
    kind: opts.kind ?? 'worker',
    model: opts.model ?? null,
    input: opts.input ?? {},
    endsAt: opts.endsAt ?? null,
    capCents: opts.capCents ?? null,
    leaseSeconds: opts.leaseSeconds ?? 300,
    createdBy: opts.createdBy ?? null,
    workspaceSha: opts.workspaceSha ?? null,
  }).returning();
  return row!;
}

/**
 * One run, scoped to the org.
 * @param orgId - Tenant.
 * @param id - Run id.
 */
export async function getWorkerRun(orgId: string, id: number): Promise<WorkerRun | null> {
  const [row] = await db.select().from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.id, id))).limit(1);
  return row ?? null;
}

/**
 * Runs for the org, newest first.
 * @param orgId - Tenant.
 * @param opts - Filters and paging.
 * @param opts.status
 * @param opts.agentSlug
 * @param opts.kind
 * @param opts.limit
 * @param opts.offset
 */
export async function listWorkerRuns(orgId: string, opts: { status?: string; agentSlug?: string; kind?: string; limit?: number; offset?: number } = {}): Promise<WorkerRun[]> {
  const where = [eq(workerRunSchema.orgId, orgId)];
  if (opts.status) {
    where.push(eq(workerRunSchema.status, opts.status));
  }
  if (opts.kind) {
    where.push(eq(workerRunSchema.kind, opts.kind));
  }
  if (opts.agentSlug) {
    where.push(eq(workerRunSchema.agentSlug, opts.agentSlug));
  }
  return db.select().from(workerRunSchema).where(and(...where)).orderBy(desc(workerRunSchema.createdAt)).limit(opts.limit ?? 50).offset(opts.offset ?? 0);
}

async function mustGet(orgId: string, id: number): Promise<WorkerRun> {
  const run = await getWorkerRun(orgId, id);
  if (!run) {
    throw new WorkerRunError('NOT_FOUND', `No worker run ${id}`, 404);
  }
  return run;
}

function mustHoldLease(run: WorkerRun, workerId: string): void {
  if (run.workerId !== workerId) {
    throw new WorkerRunError('FORBIDDEN', `Worker "${workerId}" does not hold the lease on run ${run.id}`, 403);
  }
}

function capRemainingCents(run: WorkerRun): number | null {
  return run.capCents === null ? null : Math.max(0, run.capCents - run.cents);
}

/**
 * Take the lease. Allowed from `queued`, or from `lost`/`running` once the
 * previous lease has lapsed (a re-claim — `attempt` increments). The agent's
 * per-period budget is checked here so an over-cap agent never starts work.
 * @param opts - Claim request.
 * @param opts.orgId
 * @param opts.id
 * @param opts.workerId
 */
export async function claimWorkerRun(opts: { orgId: string; id: number; workerId: string }): Promise<{ run: WorkerRun; toolClaim: string }> {
  // Claiming too, and this is the half that matters operationally: the
  // Fargate worker polls, so refusing the claim is what actually stops work
  // starting on runs that were queued before the switch was pulled. A worker
  // that already HOLDS a lease is not touched — it finishes, reports, and its
  // heartbeat, complete and fail endpoints stay open to it.
  await assertWorkspaceRunning(opts.orgId, 'worker_run');
  const run = await mustGet(opts.orgId, opts.id);
  const now = new Date();
  const leaseLapsed = run.leaseExpiresAt !== null && run.leaseExpiresAt < now;
  const claimable = run.status === 'queued' || run.status === 'lost' || (run.status === 'running' && leaseLapsed);
  if (!claimable) {
    throw new WorkerRunError('CONFLICT', `Run ${run.id} is ${run.status} and held by "${run.workerId ?? 'nobody'}"`, 409);
  }
  const budget = await preflightCheck({ orgId: run.orgId, agentSlug: run.agentSlug });
  if (!budget.ok) {
    await db.update(workerRunSchema).set({
      status: 'failed',
      error: `Budget exceeded for "${budget.agentSlug}" (${budget.reason}: ${budget.current}/${budget.limit})`,
      completedAt: now,
      updatedAt: now,
    }).where(eq(workerRunSchema.id, run.id));
    throw new WorkerRunError('BUDGET_EXCEEDED', `"${budget.agentSlug}" is over its ${budget.reason.replace('hard_', '').replace('_exceeded', '')} budget`, 402);
  }
  const [updated] = await db.update(workerRunSchema).set({
    status: 'running',
    workerId: opts.workerId,
    attempt: run.attempt + 1,
    claimedAt: now,
    heartbeatAt: now,
    leaseExpiresAt: new Date(now.getTime() + run.leaseSeconds * 1000),
    updatedAt: now,
  }).where(eq(workerRunSchema.id, run.id)).returning();
  return { run: updated!, toolClaim: toolClaimFor(updated!) };
}

export type HeartbeatInput = {
  orgId: string;
  id: number;
  workerId: string;
  progress?: Record<string, unknown>;
  cursor?: string;
  counts?: Record<string, number>;
  /** Usage since the last heartbeat. Charged to the agent's period budget; never double-report. */
  usage?: { model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; cents?: number };
  langfuseTraceId?: string;
  failures?: { scope: string; message: string }[];
};

export type HeartbeatReply = {
  run: WorkerRun;
  leaseExpiresAt: Date;
  stop: boolean;
  paused: boolean;
  endsAt: Date | null;
  capRemainingCents: number | null;
  toolClaim: string;
};

/**
 * Extend the lease, record progress and cost, return the control signals.
 * The reply is the only channel Vocion has back to the worker, so everything
 * it might need to know rides on it: stop, pause, deadline, cap left, and a
 * fresh tool claim.
 * @param input - Heartbeat payload.
 */
export async function heartbeatWorkerRun(input: HeartbeatInput): Promise<HeartbeatReply> {
  const run = await mustGet(input.orgId, input.id);
  mustHoldLease(run, input.workerId);
  if (run.status !== 'running' && run.status !== 'paused') {
    throw new WorkerRunError('CONFLICT', `Run ${run.id} is ${run.status}; heartbeats are only accepted while running or paused`, 409);
  }
  const now = new Date();
  const tokens = (input.usage?.inputTokens ?? 0) + (input.usage?.outputTokens ?? 0);
  const failures = input.failures?.length
    ? [...run.failures, ...input.failures.map(f => ({ ...f, at: now.toISOString() }))].slice(-MAX_FAILURES)
    : run.failures;
  const [updated] = await db.update(workerRunSchema).set({
    heartbeatAt: now,
    leaseExpiresAt: new Date(now.getTime() + run.leaseSeconds * 1000),
    progress: input.progress ? boundProgress(input.progress) : run.progress,
    cursor: input.cursor ?? run.cursor,
    counts: input.counts ? { ...run.counts, ...input.counts } : run.counts,
    tokens: run.tokens + tokens,
    cents: run.cents + (input.usage?.cents ?? 0),
    // The model that actually did the work wins over whatever create guessed.
    model: input.usage?.model ?? run.model,
    langfuseTraceId: input.langfuseTraceId ?? run.langfuseTraceId,
    failures,
    updatedAt: now,
  }).where(eq(workerRunSchema.id, run.id)).returning();
  if (input.usage && tokens > 0) {
    const usage: TokenUsage = {
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
    };
    await chargeUsage({ orgId: run.orgId, agentSlug: run.agentSlug, model: input.usage.model, usage });
  }
  const r = updated!;
  const capLeft = capRemainingCents(r);
  const overCap = capLeft !== null && capLeft <= 0;
  const pastDeadline = r.endsAt !== null && r.endsAt < now;
  return {
    run: r,
    leaseExpiresAt: r.leaseExpiresAt!,
    stop: r.stopRequested || overCap || pastDeadline,
    paused: r.status === 'paused',
    endsAt: r.endsAt,
    capRemainingCents: capLeft,
    toolClaim: toolClaimFor(r),
  };
}

/**
 * Terminal: the worker finished. A run that was asked to stop lands in
 * `cancelled`, not `completed`, so the record says what actually happened.
 * @param opts - Completion payload.
 * @param opts.orgId
 * @param opts.id
 * @param opts.workerId
 * @param opts.result
 * @param opts.counts
 * @param opts.summary - The worker's one-paragraph account of the run.
 */
export async function completeWorkerRun(opts: { orgId: string; id: number; workerId: string; result?: Record<string, unknown>; counts?: Record<string, number>; summary?: string | null }): Promise<WorkerRun> {
  const run = await mustGet(opts.orgId, opts.id);
  mustHoldLease(run, opts.workerId);
  const now = new Date();
  const [updated] = await db.update(workerRunSchema).set({
    status: run.stopRequested ? 'cancelled' : 'completed',
    result: opts.result ?? null,
    summary: opts.summary ?? run.summary,
    counts: opts.counts ? { ...run.counts, ...opts.counts } : run.counts,
    completedAt: now,
    heartbeatAt: now,
    updatedAt: now,
  }).where(eq(workerRunSchema.id, run.id)).returning();
  await writeBackRunCost(updated!, now);
  await announceEnded(updated!, 'worker_run.completed', updated!.summary ?? '');
  return updated!;
}

/**
 * Terminal: the worker gave up. Keeps the lease holder on the row for the audit trail.
 * @param opts - Failure payload.
 * @param opts.orgId
 * @param opts.id
 * @param opts.workerId
 * @param opts.error
 * @param opts.failures
 */
export async function failWorkerRun(opts: { orgId: string; id: number; workerId: string; error: string; failures?: { scope: string; message: string }[] }): Promise<WorkerRun> {
  const run = await mustGet(opts.orgId, opts.id);
  mustHoldLease(run, opts.workerId);
  const now = new Date();
  const failures = opts.failures?.length
    ? [...run.failures, ...opts.failures.map(f => ({ ...f, at: now.toISOString() }))].slice(-MAX_FAILURES)
    : run.failures;
  const [updated] = await db.update(workerRunSchema).set({
    status: 'failed',
    error: opts.error,
    failures,
    completedAt: now,
    heartbeatAt: now,
    updatedAt: now,
  }).where(eq(workerRunSchema.id, run.id)).returning();
  // A failed attempt still cost money, and the record's actual is the honest
  // sum over every attempt it took.
  await writeBackRunCost(updated!, now);
  await announceEnded(updated!, 'worker_run.failed', opts.error);
  return updated!;
}

/**
 * Raise the completion event for a run that just reached a terminal status,
 * so a debrief can read the work while it is fresh. Fire-and-forget in
 * effect: an event that cannot be recorded never fails the worker's own
 * write, which already happened. Deduped on the run id (and the attempt for
 * a failure, since a re-claimed run can fail again).
 * @param run - The row as written.
 * @param type - `worker_run.completed` | `worker_run.failed`.
 * @param summary - The worker's account, or the error.
 */
async function announceEnded(run: WorkerRun, type: typeof WORKER_RUN_COMPLETED | typeof WORKER_RUN_FAILED, summary: string): Promise<void> {
  const record = runRecord(run);
  const payload: WorkerRunEndedPayload = {
    workerRunId: run.id,
    agentSlug: run.agentSlug,
    kind: run.kind,
    status: run.status,
    summary: summary.slice(0, 500),
    recordType: record?.type ?? null,
    recordId: record?.id ?? null,
    attempt: run.attempt,
    cents: run.cents,
    completedAt: (run.completedAt ?? new Date()).toISOString(),
  };
  try {
    // Dynamic, like every other emitter: the bus imports the workflow and
    // automation services, and this service must stay importable from both.
    const { emitEvent } = await import('@/services/EventService');
    await emitEvent({
      orgId: run.orgId,
      type,
      payload,
      dedupeKey: type === 'worker_run.failed' ? `${type}:${run.id}:${run.attempt}` : `${type}:${run.id}`,
      invokedBy: `worker_run:${run.id}`,
    });
  } catch (error) {
    console.warn(`[worker-run] could not raise ${type} for run ${run.id}`, error);
  }
}

/**
 * The record a run was queued for, when the creator named one:
 * `input.record = {type: '<object type slug>', id: <object id>}`. Null for a
 * run that was not queued against a record — most are not.
 * @param run - The run.
 */
export function runRecord(run: Pick<WorkerRun, 'input'>): { type: string; id: number } | null {
  const rec = (run.input as Record<string, unknown> | null)?.record;
  if (!rec || typeof rec !== 'object') {
    return null;
  }
  const { type, id } = rec as Record<string, unknown>;
  const n = typeof id === 'number' ? id : Number(id);
  return typeof type === 'string' && type !== '' && Number.isInteger(n) && n > 0 ? { type, id: n } : null;
}

/**
 * What every run queued for this record has cost so far, in cents — summed
 * over the rows rather than added to the record, so a retried terminal call
 * lands the same figure and a task picked up three times is charged three
 * times, once.
 * @param orgId - Tenant.
 * @param record - The record.
 * @param record.type - Its object type slug.
 * @param record.id - Its object id.
 */
async function centsSpentOn(orgId: string, record: { type: string; id: number }): Promise<number> {
  const [row] = await db.select({ spent: sql<number>`coalesce(sum(${workerRunSchema.cents}), 0)::int` })
    .from(workerRunSchema)
    .where(and(
      eq(workerRunSchema.orgId, orgId),
      sql`${workerRunSchema.input} -> 'record' ->> 'type' = ${record.type}`,
      sql`${workerRunSchema.input} -> 'record' ->> 'id' = ${String(record.id)}`,
    ));
  return row?.spent ?? 0;
}

/**
 * A run ended: put what it cost on the record it ran for, then recompute the
 * rollups that reach that record.
 *
 * Written on the record's metadata: `actualCents` (the sum over every run
 * queued for it), `costUpdatedAt`, and — when the record carries an
 * `estimateCents`, or failing that when the run had a per-run cap to stand in
 * for one — `estimateCents` and `varianceCents` (actual minus estimate, so a
 * negative number is under budget). Cents throughout; the page renders money.
 *
 * Best effort by design: the run's own row is already terminal, and a
 * write-back that fails must not hand the worker a 500 for work it finished.
 * The failure is logged with the run and the record.
 * @param run - The terminal run.
 * @param now - When it ended.
 */
async function writeBackRunCost(run: WorkerRun, now: Date): Promise<void> {
  const record = runRecord(run);
  if (!record) {
    return;
  }
  try {
    const type = await db.query.businessObjectTypeSchema.findFirst({ where: and(eq(businessObjectTypeSchema.orgId, run.orgId), eq(businessObjectTypeSchema.slug, record.type)) });
    if (!type) {
      return;
    }
    const object = await db.query.businessObjectSchema.findFirst({ where: and(eq(businessObjectSchema.orgId, run.orgId), eq(businessObjectSchema.typeId, type.id), eq(businessObjectSchema.id, record.id)) });
    if (!object) {
      return;
    }
    const spent = await centsSpentOn(run.orgId, record);
    const meta = object.metadata ?? {};
    const estimate = typeof meta.estimateCents === 'number' ? meta.estimateCents : run.capCents ?? undefined;
    await db.update(businessObjectSchema).set({
      metadata: {
        ...meta,
        actualCents: spent,
        costUpdatedAt: now.toISOString(),
        ...(estimate === undefined ? {} : { estimateCents: estimate, varianceCents: spent - estimate }),
      },
    }).where(eq(businessObjectSchema.id, object.id));
    await recomputeRollups({ orgId: run.orgId, childType: record.type, childId: record.id, now });
  } catch (err) {
    warn('worker run cost write-back failed', { runId: run.id, record, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Warn through a dynamic import. `libs/Logger` has a top-level await, and
 * this service sits in the Temporal worker's import chain (the reaper
 * schedule), which tsx compiles as CommonJS — a static import would stop the
 * worker from starting. Same approach as `libs/Langfuse.ts`;
 * `scripts/temporal-worker.imports.test.ts` guards it.
 * @param message - What happened, in plain words.
 * @param properties - Identifiers and context worth keeping.
 */
function warn(message: string, properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.warn(message, properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}

/**
 * A human's kill switch. `queued` cancels immediately; a running run is asked
 * to stop and learns it on its next heartbeat — Vocion cannot kill a process it
 * does not host. If it never heartbeats again the reaper marks it `lost`.
 * @param orgId - Tenant.
 * @param id - Run id.
 */
export async function cancelWorkerRun(orgId: string, id: number): Promise<WorkerRun> {
  const run = await mustGet(orgId, id);
  const now = new Date();
  if (run.status === 'queued') {
    const [updated] = await db.update(workerRunSchema).set({ status: 'cancelled', completedAt: now, updatedAt: now }).where(eq(workerRunSchema.id, run.id)).returning();
    return updated!;
  }
  if (run.status === 'running' || run.status === 'paused') {
    const [updated] = await db.update(workerRunSchema).set({ stopRequested: true, updatedAt: now }).where(eq(workerRunSchema.id, run.id)).returning();
    return updated!;
  }
  throw new WorkerRunError('CONFLICT', `Run ${run.id} is already ${run.status}`, 409);
}

/**
 * Mark every running or paused run whose lease lapsed as `lost`. Called by the
 * Temporal schedule every few minutes; safe to call any time.
 * @param now - The clock, injectable for tests.
 * @returns How many runs were reaped.
 */
export async function reapLostWorkerRuns(now: Date = new Date()): Promise<number> {
  const rows = await db.update(workerRunSchema).set({
    status: 'lost',
    error: sql`coalesce(${workerRunSchema.error}, 'lease expired without a heartbeat')`,
    updatedAt: now,
  }).where(and(
    inArray(workerRunSchema.status, ['running', 'paused']),
    lt(workerRunSchema.leaseExpiresAt, now),
  )).returning({ id: workerRunSchema.id });
  return rows.length;
}
