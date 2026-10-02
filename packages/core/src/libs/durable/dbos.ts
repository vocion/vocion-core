import type { DBOSClient } from '@dbos-inc/dbos-sdk';
import type { DurableContext, DurableEngine, DurableRunState, DurableStatus } from './types';
import { waitForEventVia } from './events';
import { allDefinitions } from './registry';

/**
 * PRODUCTION RUNTIME: DBOS Transact on Vocion's own Postgres (backlog 054).
 *
 * Proved before building on it (Phase 0, 2026-10-02): a run started on old
 * code resumes on new code after a deploy, reusing recorded steps, when the
 * application version is the same; a different version does not recover it,
 * and recovery belongs to one executor id. So:
 *   - the application version is pinned (`DURABLE_APP_VERSION`, default
 *     `durable-1`); a code change that reorders a definition's steps goes
 *     behind `ctx.patched(...)`, and a deliberate bump forks pending runs;
 *   - exactly one executor (`vocion-durable`) runs definitions — the app
 *     process that calls `launchDurableExecutor` — and recovers its runs on
 *     every restart; every other caller uses the client;
 *   - DBOS's tables live in schema `durable` of the app database, so the
 *     pre-migration pg_dump covers them and drizzle never touches them.
 */

const APP = 'vocion';
const SCHEMA = 'durable';
const QUEUE = 'durable';
export const DURABLE_EXECUTOR_ID = 'vocion-durable';

function databaseUrl(): string {
  const url = process.env.DURABLE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set, so durable runs have nowhere to live');
  }
  return url;
}

export function durableAppVersion(): string {
  return process.env.DURABLE_APP_VERSION ?? 'durable-1';
}

let launched: Promise<void> | null = null;
const registered = new Map<string, (input: unknown) => Promise<unknown>>();

function dbosContext(DBOS: typeof import('@dbos-inc/dbos-sdk').DBOS): DurableContext {
  const ctx: DurableContext = {
    get workflowId() {
      return DBOS.workflowID ?? '';
    },
    step: (name, fn) => DBOS.runStep(fn, { name }),
    waitFor: (topic, timeoutSeconds) => DBOS.recv(topic, timeoutSeconds),
    waitForEvent: (name, options) => waitForEventVia(ctx, name, options),
    sleep: ms => DBOS.sleepms(ms),
    setStatus: status => DBOS.setEvent('status', status),
    async child(definition, id, input) {
      const fn = registered.get(definition);
      if (!fn) {
        throw new Error(`no durable definition named "${definition}" on this executor`);
      }
      const handle = await DBOS.startWorkflow(fn, { workflowID: id })(input);
      return handle.getResult() as never;
    },
    patched: name => DBOS.patch(name),
  };
  return ctx;
}

/**
 * Start the one executor in this process: register every definition, launch
 * DBOS (migrating its schema), and register the queue runs are started on.
 * Idempotent.
 */
export function launchDurableExecutor(): Promise<void> {
  launched ??= (async () => {
    const { DBOS } = await import('@dbos-inc/dbos-sdk');
    DBOS.setConfig({
      name: APP,
      systemDatabaseUrl: databaseUrl(),
      systemDatabaseSchemaName: SCHEMA,
      systemDatabasePoolSize: 6,
      applicationVersion: durableAppVersion(),
      executorID: DURABLE_EXECUTOR_ID,
      enablePatching: true,
      logLevel: process.env.DURABLE_LOG_LEVEL ?? 'warn',
    });
    for (const def of allDefinitions()) {
      if (!registered.has(def.name)) {
        registered.set(def.name, DBOS.registerWorkflow(async (input: unknown) => def.run(dbosContext(DBOS), input), { name: def.name }) as (input: unknown) => Promise<unknown>);
      }
    }
    await DBOS.launch();
    await DBOS.registerQueue(QUEUE, { concurrency: 50 } as never);
  })();
  return launched;
}

let client: Promise<DBOSClient> | null = null;

function dbosClient(): Promise<DBOSClient> {
  client ??= import('@dbos-inc/dbos-sdk').then(({ DBOSClient }) => DBOSClient.create({ systemDatabaseUrl: databaseUrl(), systemDatabaseSchemaName: SCHEMA, applicationName: APP, systemDatabasePoolSize: 4 }));
  return client;
}

const STATE: Record<string, DurableRunState> = {
  PENDING: 'pending',
  ENQUEUED: 'enqueued',
  SUCCESS: 'succeeded',
  ERROR: 'failed',
  CANCELLED: 'cancelled',
  MAX_RECOVERY_ATTEMPTS_EXCEEDED: 'failed',
};

const engine: DurableEngine = {
  async start(definition, id, input) {
    const c = await dbosClient();
    const h = await c.enqueue({ queueName: QUEUE, workflowName: definition, workflowID: id }, input as never);
    return { id: h.workflowID };
  },
  async signal(id, topic, message) {
    await (await dbosClient()).send(id, message, topic);
  },
  async status(id) {
    return (await (await dbosClient()).getEvent<DurableStatus>(id, 'status', 0)) ?? null;
  },
  async state(id) {
    const s = await (await dbosClient()).getWorkflow(id);
    return s ? STATE[s.status] ?? 'unknown' : 'unknown';
  },
  async cancel(id) {
    await (await dbosClient()).cancelWorkflow(id);
  },
  async steps(id) {
    return ((await (await dbosClient()).listWorkflowSteps(id)) ?? []).map(s => s.name);
  },
};

export function dbosEngine(): DurableEngine {
  return engine;
}
