import type { DurableContext } from './types';
import { defineDurable } from './registry';

/**
 * BACKGROUND JOBS ON THE DURABLE ENGINE (v0.6.0, backlog 054): what Temporal
 * used to run — every cron (a source's sync, a mission's check, a workflow's
 * trigger, an automation's schedule-when, the reapers, retention, the image
 * sweep, an eval refresh) and every one-off background start (a coalesced
 * automation fire, a bulk regenerate) — is a JOB: a named handler with a
 * retry policy, run as a durable step on DBOS in Vocion's own Postgres.
 *
 *   - A one-off start is the `vocion.job` definition under an id the caller
 *     picks; the id is the idempotency key, so the same start never runs twice.
 *   - A schedule is a named DBOS schedule (its own table in schema `durable`)
 *     pointing at the one scheduled workflow `vocion.job.tick`, whose context
 *     names the job and its input. DBOS fires each tick once (its workflow id
 *     is the schedule plus the tick time), so a deploy can neither double nor
 *     drop a fire the way two schedulers could.
 *
 * No job names live here: handlers register themselves (`services/background/catalog.ts`).
 */

export type JobRetry = {
  /** Attempts in all, the first included. */
  attempts: number;
  /** Seconds before the first retry. */
  intervalSeconds?: number;
  /** Multiplier between retries. */
  backoff?: number;
};

export type JobContext = {
  /** This run's id (a one-off's own id; a tick's schedule name + time). */
  readonly runId: string;
  /** Run `fn` once per run, retried by `retry`; replays return the recorded result. */
  step: <T>(name: string, fn: () => Promise<T>, retry?: JobRetry) => Promise<T>;
  /** A durable pause. */
  sleep: (ms: number) => Promise<void>;
};

export type JobHandler<I = any> = (input: I, ctx: JobContext) => Promise<unknown>;

type JobSpec = { handler: JobHandler; retry: JobRetry; whole: boolean };

const jobs = new Map<string, JobSpec>();

/**
 * Register a job. `whole: true` hands the handler the context to take its own
 * steps (a loop, a poll with sleeps); otherwise the handler runs as one step
 * retried by `retry`.
 * @param name - Stable name; schedules and starts refer to it.
 * @param handler - The work.
 * @param opts - Retry policy, and whether the handler takes its own steps.
 * @param opts.retry - The retry policy.
 * @param opts.whole - The handler takes its own steps.
 */
export function defineJob<I>(name: string, handler: JobHandler<I>, opts: { retry?: JobRetry; whole?: boolean } = {}): void {
  jobs.set(name, { handler: handler as JobHandler, retry: opts.retry ?? { attempts: 1 }, whole: opts.whole === true });
}

export function jobNamed(name: string): JobSpec {
  const j = jobs.get(name);
  if (!j) {
    throw new Error(`no background job named "${name}"`);
  }
  return j;
}

export function allJobNames(): string[] {
  return [...jobs.keys()];
}

/** A job and its input; `afterMs` delays it by a durable sleep (a start delay that survives a deploy). */
export type JobCall = { job: string; input?: unknown; afterMs?: number };

/**
 * Run a job inside a durable context: its own steps, or one retried step.
 * @param call
 * @param ctx
 */
export async function runJob(call: JobCall, ctx: Pick<DurableContext, 'workflowId' | 'sleep'> & { step: JobContext['step'] }): Promise<unknown> {
  const spec = jobNamed(call.job);
  const jctx: JobContext = { runId: ctx.workflowId, step: ctx.step, sleep: ctx.sleep };
  if (call.afterMs && call.afterMs > 0) {
    await ctx.sleep(call.afterMs);
  }
  return spec.whole
    ? spec.handler(call.input ?? {}, jctx)
    : jctx.step(call.job, () => spec.handler(call.input ?? {}, jctx), spec.retry);
}

/** The one-off start: `vocion.job` under the caller's id. */
export const JOB_DEFINITION = 'vocion.job';
/** The one workflow every schedule fires. */
export const JOB_TICK_WORKFLOW = 'vocion.job.tick';

defineDurable<JobCall, unknown>({
  name: JOB_DEFINITION,
  run: (ctx, input) => runJob(input, ctx as never),
});

export type ScheduleSpec = {
  /** Stable, unique name — what pause, remove and describe address. */
  name: string;
  /** Cron (5 fields, or 6 with seconds). */
  cron: string;
  job: string;
  input?: unknown;
  /** IANA zone for the cron; UTC when absent. */
  timezone?: string | null;
};

export type ScheduleState = { name: string; cron: string; paused: boolean; lastFiredAt: string | null; job: string | null };

export type ScheduleBackend = {
  upsert: (spec: ScheduleSpec) => Promise<void>;
  remove: (name: string) => Promise<void>;
  pause: (name: string) => Promise<void>;
  resume: (name: string) => Promise<void>;
  describe: (name: string) => Promise<ScheduleState | null>;
  list: (prefix?: string) => Promise<ScheduleState[]>;
};

async function backend(): Promise<ScheduleBackend> {
  const { durableMode } = await import('./index');
  if (durableMode() === 'memory') {
    return (await import('./memory')).memorySchedules();
  }
  return (await import('./dbos')).dbosSchedules();
}

/**
 * Create or update a schedule to fire `job` on `cron`. Idempotent.
 * @param spec
 */
export async function scheduleJob(spec: ScheduleSpec): Promise<void> {
  await (await backend()).upsert(spec);
}

/**
 * Remove a schedule; absent is not an error.
 * @param name
 */
export async function unscheduleJob(name: string): Promise<void> {
  await (await backend()).remove(name);
}

export async function pauseSchedule(name: string): Promise<void> {
  await (await backend()).pause(name);
}

export async function resumeSchedule(name: string): Promise<void> {
  await (await backend()).resume(name);
}

/**
 * A schedule as the engine holds it, or null when there is none.
 * @param name
 */
export async function describeSchedule(name: string): Promise<ScheduleState | null> {
  return (await backend()).describe(name);
}

export async function listSchedules(prefix?: string): Promise<ScheduleState[]> {
  return (await backend()).list(prefix);
}

/**
 * Start a job once under `id` (the id is its idempotency key).
 * @param id
 * @param call
 */
export async function startJob(id: string, call: JobCall): Promise<{ id: string }> {
  const { durable } = await import('./index');
  return durable().start(JOB_DEFINITION, id, call);
}
