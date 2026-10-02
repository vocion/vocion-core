/**
 * DURABLE WORK — a run that owns its next step (backlog 054).
 *
 * A definition is ordinary code over a small context: every side effect is a
 * named `step` (recorded once, replayed from its record after a crash or a
 * deploy), waits are `waitFor` a message or `waitForEvent` an event, and what
 * a page should show is `setStatus`. Two runtimes implement the context: DBOS
 * on Vocion's own Postgres in production (`dbos.ts`), and an in-process one
 * for tests (`memory.ts`). Definitions never import either.
 */

/** What a page shows for a run: a stage, one line, and anything typed it needs. */
export type DurableStatus = { stage: string; line: string; [key: string]: unknown };

/** An event delivered to a waiting run: the `event_log` row's type, payload and time. */
export type DeliveredEvent = { type: string; payload: Record<string, unknown>; at: string };

/** One kind of event that answers a wait: its types, and payload fields it carries with exactly these values. */
export type EventSpec = { types: string[]; match: Record<string, unknown> };

export type WaitForEventOptions = {
  /** The workspace the event must belong to. */
  orgId: string;
  /** Event types that answer this wait (shorthand for one `any` entry). */
  types?: string[];
  /** Payload fields the event must carry with exactly these values (with `types`). */
  match?: Record<string, unknown>;
  /** The first event matching any of these answers the wait. */
  any?: EventSpec[];
  /** How long to wait before answering null. */
  timeoutSeconds: number;
  /** Events from this time on count (an event raised before the wait opened is not lost). Defaults to when the wait opened. */
  since?: string;
};

export type DurableContext = {
  /** This run's id: the record key it was started with. */
  readonly workflowId: string;
  /** Run `fn` once; on replay its recorded result is returned without running it again. */
  step: <T>(name: string, fn: () => Promise<T>, retry?: { attempts: number; intervalSeconds?: number; backoff?: number }) => Promise<T>;
  /** The next message sent to this run on `topic`, or null after the timeout (at most `MAX_WAIT_SECONDS`; wait longer in a loop). */
  waitFor: <T>(topic: string, timeoutSeconds: number) => Promise<T | null>;
  /** The first event matching the wait, or null after the timeout. `name` is unique within the run. */
  waitForEvent: (name: string, options: WaitForEventOptions) => Promise<DeliveredEvent | null>;
  sleep: (ms: number) => Promise<void>;
  setStatus: (status: DurableStatus) => Promise<void>;
  /** Start another definition as a child run and wait for its result. */
  child: <I, O>(definition: string, id: string, input: I) => Promise<O>;
  /** Code-change guard for long-lived runs: true when this run started on code that has the patch. */
  patched: (name: string) => Promise<boolean>;
};

export type DurableDefinition<I = unknown, O = unknown> = {
  /** Stable name; changing it orphans the runs started under it. */
  name: string;
  run: (ctx: DurableContext, input: I) => Promise<O>;
};

export type DurableRunState = 'pending' | 'enqueued' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

export type DurableEngine = {
  /** Start a run; a run already started under this id is returned, never started twice. */
  start: <I>(definition: string, id: string, input: I) => Promise<{ id: string }>;
  /** Send a message to a run on a topic; it waits in the run's mailbox until read. */
  signal: (id: string, topic: string, message: unknown) => Promise<void>;
  status: (id: string) => Promise<DurableStatus | null>;
  state: (id: string) => Promise<DurableRunState>;
  cancel: (id: string) => Promise<void>;
  steps: (id: string) => Promise<string[]>;
};

/** The longest single wait: longer waits loop (a timer past ~24.8 days fires at once). */
export const MAX_WAIT_SECONDS = 7 * 24 * 60 * 60;
