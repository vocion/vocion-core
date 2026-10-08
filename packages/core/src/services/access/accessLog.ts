/**
 * THE ACCESS LOG'S ONE WRITER — who viewed, downloaded, exported or searched
 * which record, and when (`access_event`, migration 0177).
 *
 * Every read surface reports through here, and nothing else writes the table:
 *
 *   - a person's read: the record and artifact pages, the preview panel, the
 *     artifact and media file routes, exports, the Search page — through
 *     {@link notePersonRead} / {@link noteCallerRead} / {@link noteLinkRead};
 *   - an agent's read: the tool-call recorder opens an access scope around
 *     every domain tool (`services/agents/toolCallRecord.ts`, the one seam all
 *     three harnesses share), and a tool says what it read with
 *     {@link noteRead}. The scope knows who and on which run; the tool knows
 *     what. The MCP server opens the same scope around its tools.
 *
 * Cheap by construction:
 *
 *   - A read never waits for its log row. {@link recordAccess} appends to an
 *     in-process buffer and returns; a timer writes the buffer as one
 *     multi-row insert a second later, or sooner when it fills.
 *   - The same actor reading the same record the same way inside a minute is
 *     one row, not one per re-render, refetch or retry.
 *   - A failed write never fails the read. The batch is retried on the next
 *     flush, twice, and only then dropped — and a drop is logged at error
 *     level with its count, never silent (Accelerate, never block §3).
 *
 * The buffer lives on `globalThis`, like the database handle (`libs/DB.ts`):
 * `next build` puts a module in more than one server chunk, and two buffers
 * would coalesce separately. A process killed hard loses at most the last
 * second of reads; that is the price of never holding a read up.
 *
 * Under Vitest the timer is off: a test writes by awaiting
 * {@link flushAccessLog}, which returns what it wrote, retried and dropped,
 * so a success path is asserted rather than assumed.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';
import { inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accessEventSchema, projectSchema } from '@/models/Schema';
import { clientOf, currentRequestClient } from './client';

/** What a reader did with a record. */
export const ACCESS_ACTIONS = ['view', 'download', 'export', 'search'] as const;
export type AccessAction = typeof ACCESS_ACTIONS[number];

/** Who read it. One shape for every surface; the row stores it flat. */
export type AccessActor
  = | { kind: 'user'; userId: string }
    /**
     * An agent on a run. `onBehalfOf` is who the run was for, as the runtime
     * context names it — a user id, `token:<id>`, or the trigger (`scheduled`,
     * `mcp`) — stored as given, not interpreted.
     */
    | { kind: 'agent'; agentSlug: string; onBehalfOf?: string | null; run?: { kind: string; id: string | number } | null }
    /** A workspace API token (`vcn_live_…`, or the MCP server's bearer). */
    | { kind: 'token'; tokenId: string }
    /** Anyone holding a public share link. */
    | { kind: 'link' };

/** What was read. `record.kind` is the `RecordRef.type` vocabulary every surface already speaks. */
export type AccessRead = {
  action: AccessAction;
  record: { kind: string; id?: string | number | null };
  /** A small envelope — a hit count, a format. Never content. */
  detail?: Record<string, string | number | boolean>;
};

export type AccessClient = { ipHash: string | null; uaHash: string | null };

export type AccessEvent = AccessRead & {
  /** The workspace (project id). */
  orgId: string;
  /** The company owning it, when the caller already holds it; looked up otherwise. */
  accountId?: string | null;
  actor: AccessActor;
  /** The surface: `page`, `preview`, `app`, `api`, `share`, `tool:<name>`, `mcp:<name>`. */
  via: string;
  client?: AccessClient | null;
  /** Override for tests; the row defaults to now. */
  at?: Date;
};

type Row = typeof accessEventSchema.$inferInsert;
type Pending = { row: Row; attempts: number };

export type AccessLogStats = {
  /** Rows written since the process started (or the last test reset). */
  written: number;
  /** Rows given up on after their last retry. Each drop was logged. */
  dropped: number;
  /** Events folded into an identical one inside the coalescing window. */
  coalesced: number;
  /** Rows waiting for the next flush. */
  pending: number;
};

/** Wait this long after the first buffered event before writing. */
const FLUSH_DELAY_MS = 1_000;
/** One insert writes at most this many rows; a fuller buffer flushes at once. */
const MAX_BATCH = 500;
/** Beyond this many waiting rows the oldest are dropped, loudly — the database is down. */
const MAX_PENDING = 10_000;
/** Tries per row before it is dropped. */
const MAX_ATTEMPTS = 3;
/** The same actor reading the same record the same way inside this window is one row. */
const COALESCE_MS = 60_000;
/** Recent coalescing keys kept before the oldest are swept. */
const MAX_RECENT = 20_000;

type State = {
  pending: Pending[];
  recent: Map<string, number>;
  accounts: Map<string, string | null>;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
  stats: { written: number; dropped: number; coalesced: number };
  autoFlush: boolean;
};

const globalForAccessLog = globalThis as unknown as { vocionAccessLog?: State };

function freshState(): State {
  return {
    pending: [],
    recent: new Map(),
    accounts: new Map(),
    timer: null,
    flushing: null,
    stats: { written: 0, dropped: 0, coalesced: 0 },
    autoFlush: !process.env.VITEST,
  };
}

function state(): State {
  globalForAccessLog.vocionAccessLog ??= freshState();
  return globalForAccessLog.vocionAccessLog;
}

/**
 * Report a problem on the console, as the tool-call recorder does: this
 * module rides in the agent harness, which the CLI scripts load as CommonJS,
 * and the LogTape logger pulls the validated environment in with it. The
 * console is what every process here already ships to its log sink.
 * @param level - `warn` for a refused event, `error` for a lost one.
 * @param message - What happened.
 * @param properties - Counts and ids, never content.
 */
function log(level: 'warn' | 'error', message: string, properties: Record<string, unknown>): void {
  if (level === 'error') {
    console.error(`[access-log] ${message}`, properties);
  } else {
    console.warn(`[access-log] ${message}`, properties);
  }
}

function actorColumns(actor: AccessActor): Pick<Row, 'actorKind' | 'actorId' | 'onBehalfOf' | 'runKind' | 'runId'> {
  switch (actor.kind) {
    case 'user':
      return { actorKind: 'user', actorId: actor.userId, onBehalfOf: null, runKind: null, runId: null };
    case 'agent':
      return {
        actorKind: 'agent',
        actorId: actor.agentSlug,
        onBehalfOf: actor.onBehalfOf ?? null,
        runKind: actor.run ? actor.run.kind : null,
        runId: actor.run ? String(actor.run.id) : null,
      };
    case 'token':
      return { actorKind: 'token', actorId: actor.tokenId.startsWith('token:') ? actor.tokenId : `token:${actor.tokenId}`, onBehalfOf: null, runKind: null, runId: null };
    case 'link':
      return { actorKind: 'link', actorId: null, onBehalfOf: null, runKind: null, runId: null };
  }
}

/**
 * The row an event becomes, or null for one that names no workspace, no
 * action we know or no kind of record — said once in the log, never written
 * half-formed.
 * @param event - The read.
 */
export function accessRow(event: AccessEvent): Row | null {
  const recordKind = event.record.kind?.trim();
  if (!event.orgId || !recordKind || !(ACCESS_ACTIONS as readonly string[]).includes(event.action)) {
    log('warn', 'event refused as malformed', { orgId: event.orgId || null, action: event.action, recordKind: recordKind || null, via: event.via });
    return null;
  }
  const id = event.record.id;
  return {
    orgId: event.orgId,
    accountId: event.accountId ?? null,
    ...actorColumns(event.actor),
    action: event.action,
    recordKind,
    recordId: id === null || id === undefined || id === '' ? null : String(id),
    via: event.via,
    ipHash: event.client?.ipHash ?? null,
    uaHash: event.client?.uaHash ?? null,
    detail: event.detail && Object.keys(event.detail).length > 0 ? event.detail : null,
    ...(event.at ? { at: event.at } : {}),
  };
}

function coalesceKey(row: Row): string {
  return [row.orgId, row.actorKind, row.actorId, row.onBehalfOf, row.runKind, row.runId, row.action, row.recordKind, row.recordId].map(v => v ?? '').join('\u0001');
}

function seenRecently(s: State, key: string, now: number): boolean {
  const last = s.recent.get(key);
  if (last !== undefined && now - last < COALESCE_MS) {
    return true;
  }
  s.recent.set(key, now);
  if (s.recent.size > MAX_RECENT) {
    for (const [k, at] of s.recent) {
      if (now - at >= COALESCE_MS) {
        s.recent.delete(k);
      }
    }
    // Still full of live keys: forget the oldest half rather than grow.
    if (s.recent.size > MAX_RECENT) {
      let n = Math.floor(s.recent.size / 2);
      for (const k of s.recent.keys()) {
        if (n-- <= 0) {
          break;
        }
        s.recent.delete(k);
      }
    }
  }
  return false;
}

function schedule(s: State, delay = FLUSH_DELAY_MS): void {
  if (!s.autoFlush || s.timer) {
    return;
  }
  s.timer = setTimeout(() => {
    s.timer = null;
    void flushAccessLog();
  }, delay);
  s.timer.unref?.();
}

/**
 * Record one read. Returns at once; the row is written with the next batch.
 * Never throws, and never waits on the database.
 * @param event - Who read what, where.
 */
export function recordAccess(event: AccessEvent): void {
  try {
    const row = accessRow(event);
    if (!row) {
      return;
    }
    const s = state();
    if (seenRecently(s, coalesceKey(row), event.at?.getTime() ?? Date.now())) {
      s.stats.coalesced += 1;
      return;
    }
    s.pending.push({ row, attempts: 0 });
    if (s.pending.length > MAX_PENDING) {
      const over = s.pending.splice(0, s.pending.length - MAX_PENDING);
      s.stats.dropped += over.length;
      log('error', 'buffer full, oldest reads dropped unwritten', { dropped: over.length, pending: s.pending.length });
    }
    if (s.pending.length >= MAX_BATCH && s.autoFlush) {
      void flushAccessLog();
    } else {
      schedule(s);
    }
  } catch (error) {
    log('error', 'could not buffer a read', { error: String(error) });
  }
}

/**
 * Fill in the owning account for rows that arrived without one, one query per
 * batch for the workspaces not seen before. A failed lookup leaves the column
 * null; it never costs the rows.
 * @param s - The log's state.
 * @param rows - The batch.
 */
async function withAccounts(s: State, rows: Row[]): Promise<void> {
  const unknown = [...new Set(rows.filter(r => !r.accountId && !s.accounts.has(r.orgId)).map(r => r.orgId))];
  if (unknown.length > 0) {
    try {
      const found = await db
        .select({ id: projectSchema.id, accountId: projectSchema.accountId })
        .from(projectSchema)
        .where(inArray(projectSchema.id, unknown));
      const byId = new Map(found.map(p => [p.id, p.accountId]));
      for (const id of unknown) {
        s.accounts.set(id, byId.get(id) ?? null);
      }
    } catch (error) {
      log('warn', 'owning account lookup failed; rows written without it', { workspaces: unknown.length, error: String(error) });
    }
  }
  for (const row of rows) {
    row.accountId ??= s.accounts.get(row.orgId) ?? null;
  }
}

/**
 * Write one batch. On failure the batch goes back to the front of the queue
 * for another try, and a row out of tries is dropped with an error line.
 * @param s - The log's state.
 * @returns Whether the write succeeded.
 */
async function writeBatch(s: State): Promise<boolean> {
  const batch = s.pending.splice(0, MAX_BATCH);
  if (batch.length === 0) {
    return true;
  }
  try {
    const rows = batch.map(p => p.row);
    await withAccounts(s, rows);
    await db.insert(accessEventSchema).values(rows);
    s.stats.written += batch.length;
    return true;
  } catch (error) {
    const retry = batch.filter(p => ++p.attempts < MAX_ATTEMPTS);
    const dropped = batch.length - retry.length;
    s.pending.unshift(...retry);
    s.stats.dropped += dropped;
    log('error', dropped > 0 ? 'write failed; reads dropped after their last retry' : 'write failed; will retry', {
      batch: batch.length,
      retrying: retry.length,
      dropped,
      error: String(error),
    });
    return false;
  }
}

/**
 * Write everything buffered now. Stops at the first failed batch (the rest
 * waits for the next flush rather than hammering a database that is down),
 * and schedules that next flush itself.
 * @returns The running totals, including what is still pending.
 */
export async function flushAccessLog(): Promise<AccessLogStats> {
  const s = state();
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  while (s.flushing) {
    await s.flushing;
  }
  s.flushing = (async () => {
    while (s.pending.length > 0) {
      if (!(await writeBatch(s))) {
        schedule(s, FLUSH_DELAY_MS * 5);
        return;
      }
    }
  })();
  try {
    await s.flushing;
  } finally {
    s.flushing = null;
  }
  return accessLogStats();
}

/** The running totals. */
export function accessLogStats(): AccessLogStats {
  const s = state();
  return { ...s.stats, pending: s.pending.length };
}

/**
 * Forget everything buffered, counted and cached. Tests only.
 * @param opts - `autoFlush` turns the timer on for a test that wants it.
 * @param opts.autoFlush - Write on the timer, as production does.
 */
export function resetAccessLogForTests(opts: { autoFlush?: boolean } = {}): void {
  const s = state();
  if (s.timer) {
    clearTimeout(s.timer);
  }
  globalForAccessLog.vocionAccessLog = { ...freshState(), autoFlush: opts.autoFlush ?? false };
}

/* ------------------------------------------------------------------ */
/* Scopes — who is reading, for code that only knows what it read     */
/* ------------------------------------------------------------------ */

/** Who is reading for the duration of a call, and through which surface. */
export type AccessScope = {
  orgId: string;
  accountId?: string | null;
  actor: AccessActor;
  via: string;
  client?: AccessClient | null;
};

const scopes = new AsyncLocalStorage<AccessScope>();

/**
 * Run `fn` with a reader in scope, so a {@link noteRead} anywhere beneath it —
 * however deep, across awaits — is recorded as that reader's.
 * @param scope - Who is reading, and where.
 * @param fn - The work.
 */
export function withAccessScope<T>(scope: AccessScope, fn: () => T): T {
  return scopes.run(scope, fn);
}

/**
 * Note a read by whoever is in scope: the tool reports what it read, the
 * scope says who read it. Outside a scope it records nothing — a system read
 * (a sweep, a backfill, a rollup) is not somebody looking at a record.
 * @param read - What was read.
 * @returns Whether a reader was in scope.
 */
export function noteRead(read: AccessRead): boolean {
  const scope = scopes.getStore();
  if (!scope) {
    return false;
  }
  recordAccess({ ...scope, ...read });
  return true;
}

/* ------------------------------------------------------------------ */
/* People — one call per surface                                      */
/* ------------------------------------------------------------------ */

/**
 * A signed-in person's read, from a server component or an RPC handler. The
 * client fingerprint is read off the request being served. Fire-and-forget:
 * call it with `void`.
 * @param viewer - The session's workspace and person.
 * @param viewer.orgId - The workspace.
 * @param viewer.userId - The person; nothing is recorded without one.
 * @param viewer.accountId - The company, when the session carries it.
 * @param read - What they read, and through which surface.
 * @param headers - The request's headers, when the caller holds them.
 */
export async function notePersonRead(
  viewer: { orgId: string | null | undefined; userId: string | null | undefined; accountId?: string | null },
  read: AccessRead & { via: string },
  headers?: Pick<Headers, 'get'> | null,
): Promise<void> {
  try {
    if (!viewer.orgId || !viewer.userId) {
      return;
    }
    const client = headers ? clientOf(headers) : await currentRequestClient();
    recordAccess({ ...read, orgId: viewer.orgId, accountId: viewer.accountId ?? null, actor: { kind: 'user', userId: viewer.userId }, client });
  } catch (error) {
    log('error', 'could not note a person\'s read', { via: read.via, error: String(error) });
  }
}

/**
 * A read through `/api/*`, by a dashboard session or a workspace token
 * (`authApi`'s caller). Synchronous: the request is in hand.
 * @param caller - Who `authApi` resolved.
 * @param caller.orgId - The workspace.
 * @param caller.actorId - The user id, or `token:<id>` for a token.
 * @param caller.source - Which credential it was.
 * @param read - What was read, and through which surface.
 * @param headers - The request's headers.
 */
export function noteCallerRead(
  caller: { orgId: string; actorId: string; source: 'session' | 'token' },
  read: AccessRead & { via: string },
  headers: Pick<Headers, 'get'> | null,
): void {
  const actor: AccessActor = caller.source === 'token'
    ? { kind: 'token', tokenId: caller.actorId }
    : { kind: 'user', userId: caller.actorId };
  recordAccess({ ...read, orgId: caller.orgId, actor, client: clientOf(headers) });
}

/**
 * A read through a public share link: nobody signed in, the link is the
 * credential. The fingerprint is all there is to tell two readers apart.
 * @param orgId - The workspace the shared thing belongs to.
 * @param read - What was read, and through which surface.
 * @param headers - The request's headers, when the caller holds them.
 */
export async function noteLinkRead(orgId: string, read: AccessRead & { via: string }, headers?: Pick<Headers, 'get'> | null): Promise<void> {
  try {
    const client = headers ? clientOf(headers) : await currentRequestClient();
    recordAccess({ ...read, orgId, actor: { kind: 'link' }, client });
  } catch (error) {
    log('error', 'could not note a share-link read', { via: read.via, error: String(error) });
  }
}
