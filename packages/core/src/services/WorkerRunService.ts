import type { TokenUsage } from '@/libs/pricing';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workerRunSchema } from '@/models/Schema';
import { signClaim } from '@/services/agents/claims';
import { chargeUsage, preflightCheck } from '@/services/BudgetService';

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
 */

export type WorkerRunStatus = 'queued' | 'running' | 'paused' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled' | 'lost';

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
}): Promise<WorkerRun> {
  const [row] = await db.insert(workerRunSchema).values({
    orgId: opts.orgId,
    agentSlug: opts.agentSlug,
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
 * @param opts.limit
 * @param opts.offset
 */
export async function listWorkerRuns(orgId: string, opts: { status?: string; agentSlug?: string; limit?: number; offset?: number } = {}): Promise<WorkerRun[]> {
  const where = [eq(workerRunSchema.orgId, orgId)];
  if (opts.status) {
    where.push(eq(workerRunSchema.status, opts.status));
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
      error: `Budget exceeded for agent "${run.agentSlug}" (${budget.reason}: ${budget.current}/${budget.limit})`,
      completedAt: now,
      updatedAt: now,
    }).where(eq(workerRunSchema.id, run.id));
    throw new WorkerRunError('BUDGET_EXCEEDED', `Agent "${run.agentSlug}" is over its ${budget.reason.replace('hard_', '').replace('_exceeded', '')} budget`, 402);
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
  usage?: { model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cents?: number };
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
    progress: input.progress ?? run.progress,
    cursor: input.cursor ?? run.cursor,
    counts: input.counts ? { ...run.counts, ...input.counts } : run.counts,
    tokens: run.tokens + tokens,
    cents: run.cents + (input.usage?.cents ?? 0),
    langfuseTraceId: input.langfuseTraceId ?? run.langfuseTraceId,
    failures,
    updatedAt: now,
  }).where(eq(workerRunSchema.id, run.id)).returning();
  if (input.usage && tokens > 0) {
    const usage: TokenUsage = { inputTokens: input.usage.inputTokens, outputTokens: input.usage.outputTokens, cacheReadTokens: input.usage.cacheReadTokens };
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
 */
export async function completeWorkerRun(opts: { orgId: string; id: number; workerId: string; result?: Record<string, unknown>; counts?: Record<string, number> }): Promise<WorkerRun> {
  const run = await mustGet(opts.orgId, opts.id);
  mustHoldLease(run, opts.workerId);
  const now = new Date();
  const [updated] = await db.update(workerRunSchema).set({
    status: run.stopRequested ? 'cancelled' : 'completed',
    result: opts.result ?? null,
    counts: opts.counts ? { ...run.counts, ...opts.counts } : run.counts,
    completedAt: now,
    heartbeatAt: now,
    updatedAt: now,
  }).where(eq(workerRunSchema.id, run.id)).returning();
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
  return updated!;
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
