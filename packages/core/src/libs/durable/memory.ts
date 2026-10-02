import type { DurableContext, DurableEngine, DurableRunState, DurableStatus } from './types';
import { waitForEventVia } from './events';
import { definitionNamed } from './registry';

/** Thrown into a run's pending wait when the run is cancelled. */
export class DurableCancelledError extends Error {
  constructor(id: string) {
    super(`durable run ${id} was cancelled`);
    this.name = 'DurableCancelledError';
  }
}

type Run = {
  state: DurableRunState;
  status: DurableStatus | null;
  steps: string[];
  mailbox: Map<string, unknown[]>;
  waiters: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  cancelled: boolean;
  done: Promise<unknown>;
};

const runs = new Map<string, Run>();

/** The longest delay a Node timer takes; longer ones fire at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** Forget every run (between tests). */
export function resetMemoryEngine(): void {
  runs.clear();
}

function contextFor(id: string, run: Run): DurableContext {
  const ctx: DurableContext = {
    workflowId: id,
    async step(name, fn, retry) {
      if (run.cancelled) {
        throw new DurableCancelledError(id);
      }
      run.steps.push(name);
      const attempts = Math.max(1, retry?.attempts ?? 1);
      for (let n = 1; ; n++) {
        try {
          return await fn();
        } catch (err) {
          if (n >= attempts) {
            throw err;
          }
        }
      }
    },
    waitFor<T>(topic: string, timeoutSeconds: number): Promise<T | null> {
      run.steps.push(`recv:${topic}`);
      const queued = run.mailbox.get(topic);
      if (queued && queued.length > 0) {
        return Promise.resolve(queued.shift() as T);
      }
      return new Promise<T | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          run.waiters.delete(topic);
          resolve(null);
        }, Math.min(MAX_TIMER_MS, Math.max(0, timeoutSeconds) * 1000));
        run.waiters.set(topic, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v as T);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
      });
    },
    waitForEvent(name, options) {
      return waitForEventVia(ctx, name, options);
    },
    async sleep(ms) {
      run.steps.push('sleep');
      await new Promise(r => setTimeout(r, ms));
    },
    async setStatus(status) {
      run.status = status;
    },
    async child(definition, childId, input) {
      // eslint-disable-next-line ts/no-use-before-define -- the engine and a run's context refer to each other
      await engine.start(definition, childId, input);
      return runs.get(childId)!.done as never;
    },
    async patched() {
      return true;
    },
  };
  return ctx;
}

const engine: DurableEngine = {
  async start(definition, id, input) {
    if (runs.has(id)) {
      return { id };
    }
    const def = definitionNamed(definition);
    const run: Run = { state: 'pending', status: null, steps: [], mailbox: new Map(), waiters: new Map(), cancelled: false, done: Promise.resolve() };
    runs.set(id, run);
    run.done = (async () => {
      await Promise.resolve();
      try {
        const out = await def.run(contextFor(id, run), input);
        run.state = run.cancelled ? 'cancelled' : 'succeeded';
        return out;
      } catch (err) {
        run.state = run.cancelled ? 'cancelled' : 'failed';
        if (!run.cancelled) {
          throw err;
        }
        return undefined;
      }
    })();
    run.done.catch(() => undefined);
    return { id };
  },
  async signal(id, topic, message) {
    const run = runs.get(id);
    if (!run) {
      return;
    }
    const waiter = run.waiters.get(topic);
    if (waiter) {
      run.waiters.delete(topic);
      waiter.resolve(message);
      return;
    }
    const q = run.mailbox.get(topic) ?? [];
    q.push(message);
    run.mailbox.set(topic, q);
  },
  async status(id) {
    return runs.get(id)?.status ?? null;
  },
  async state(id) {
    return runs.get(id)?.state ?? 'unknown';
  },
  async cancel(id) {
    const run = runs.get(id);
    if (!run || run.state !== 'pending') {
      return;
    }
    run.cancelled = true;
    for (const w of run.waiters.values()) {
      w.reject(new DurableCancelledError(id));
    }
    run.waiters.clear();
  },
  async steps(id) {
    return [...(runs.get(id)?.steps ?? [])];
  },
};

/**
 * The in-process runtime: every run in this process's memory, gone on exit.
 * For tests and local scripts; production runs on DBOS (`dbos.ts`).
 */
export function memoryEngine(): DurableEngine {
  return engine;
}

/**
 * A run's settled result, for tests.
 * @param id - The run.
 */
export function memoryRunResult(id: string): Promise<unknown> {
  return runs.get(id)?.done ?? Promise.resolve(undefined);
}

const schedules = new Map<string, { spec: import('./jobs').ScheduleSpec; paused: boolean; lastFiredAt: string | null }>();

/** Schedules held in this process, for tests: `fireMemorySchedule` runs a tick. */
export function memorySchedules(): import('./jobs').ScheduleBackend {
  const state = (name: string) => {
    const s = schedules.get(name);
    return s ? { name, cron: s.spec.cron, paused: s.paused, lastFiredAt: s.lastFiredAt, job: s.spec.job } : null;
  };
  return {
    async upsert(spec) {
      const prev = schedules.get(spec.name);
      schedules.set(spec.name, { spec, paused: prev?.paused ?? false, lastFiredAt: prev?.lastFiredAt ?? null });
    },
    async remove(name) {
      schedules.delete(name);
    },
    async pause(name) {
      const s = schedules.get(name);
      if (s) {
        s.paused = true;
      }
    },
    async resume(name) {
      const s = schedules.get(name);
      if (s) {
        s.paused = false;
      }
    },
    async describe(name) {
      return state(name);
    },
    async list(prefix) {
      return [...schedules.keys()].filter(n => !prefix || n.startsWith(prefix)).map(n => state(n)!);
    },
  };
}

/**
 * Fire one tick of a memory schedule now (tests).
 * @param name
 * @param at
 */
export async function fireMemorySchedule(name: string, at: Date = new Date()): Promise<unknown> {
  const s = schedules.get(name);
  if (!s || s.paused) {
    return undefined;
  }
  s.lastFiredAt = at.toISOString();
  const { startJob } = await import('./jobs');
  const id = `sched-${name}-${at.toISOString()}`;
  await startJob(id, { job: s.spec.job, input: s.spec.input });
  return memoryRunResult(id);
}

export function resetMemorySchedules(): void {
  schedules.clear();
}
