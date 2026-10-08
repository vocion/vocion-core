/**
 * THE ACCESS LOG'S ONE WRITER — who viewed, downloaded, exported or searched
 * which record, and when (`access_event`, migration 0177).
 *
 * Every read surface reports through here, and nothing else writes the table:
 *
 *   - a person's read: the record and artifact pages, the preview panel, the
 *     artifact and media file routes, exports, the Search page, the share
 *     pages — through {@link notePersonRead} / {@link noteCallerRead} /
 *     {@link noteLinkRead};
 *   - an agent's read: the tool-call recorder opens an access scope around
 *     every domain tool (`services/agents/toolCallRecord.ts`, the one seam all
 *     three harnesses share), and a tool says what it read with
 *     {@link noteRead} — or declares it beside its schema and the recorder
 *     writes the row (`services/agents/toolReads.ts`). The scope knows who and
 *     on which run; the tool knows what. The MCP server opens the same scope
 *     around its tools.
 *
 * Cheap by construction:
 *
 *   - A read never waits for its log row. {@link recordAccess} appends to an
 *     in-process buffer and returns; a timer writes the buffer as one
 *     multi-row insert a second later, or sooner when it fills. The row keeps
 *     the moment of the read, not of the write.
 *   - The same reader VIEWING the same record from the same client inside a
 *     minute is one row, not one per re-render, refetch or a player's range
 *     request. A search, an export and a download are never folded: each one
 *     is what an audit is for (a token paging through a list is N searches).
 *
 * Never silently lost:
 *
 *   - What a row carries is cleaned before it is buffered: NUL and lone
 *     surrogates (which Postgres text and jsonb refuse) are stripped and every
 *     field is capped, so a reader cannot hand us a value that fails a batch.
 *   - A batch the database refuses while it is answering is written row by
 *     row: only a row the database refuses on its own is dropped, with an
 *     error line, so one bad read never costs another tenant's reads.
 *   - A batch that fails because the database is not answering waits and is
 *     retried with backoff for {@link KEEP_FAILED_MS} — longer than a managed
 *     database's failover — before it is dropped, counted and logged.
 *   - On the way out (`beforeExit`, `SIGTERM`) the buffer is flushed, and a
 *     process that exits with reads still unwritten says how many.
 *
 * The buffer lives on `globalThis`, like the database handle (`libs/DB.ts`):
 * `next build` puts a module in more than one server chunk, and two buffers
 * would coalesce separately.
 *
 * Under Vitest the timer and the exit hooks are off: a test writes by
 * awaiting {@link flushAccessLog}, which returns what it wrote, kept and
 * dropped, so a success path is asserted rather than assumed.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import process from 'node:process';
import { inArray, sql } from 'drizzle-orm';
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
  /** When the read happened; now by default. */
  at?: Date;
};

type Row = typeof accessEventSchema.$inferInsert;
/** A buffered row, and when its first failed write was (it is dropped {@link KEEP_FAILED_MS} after). */
type Pending = { row: Row; firstFailedAt: number | null };

export type AccessLogStats = {
  /** Rows written since the process started (or the last test reset). */
  written: number;
  /** Rows given up on. Each drop was logged with its reason. */
  dropped: number;
  /** View events folded into an identical one inside the coalescing window. */
  coalesced: number;
  /** Rows waiting for the next flush. */
  pending: number;
};

/** Wait this long after the first buffered event before writing. */
const FLUSH_DELAY_MS = 1_000;
/** The longest wait between retries while the database is not answering. */
const MAX_RETRY_DELAY_MS = 30_000;
/** One insert writes at most this many rows; a fuller buffer flushes at once. */
const MAX_BATCH = 500;
/** Beyond this many waiting rows the oldest are dropped, loudly — the database has been down a while. */
const MAX_PENDING = 25_000;
/**
 * How long a row whose write failed is kept and retried: well past a managed
 * database's failover (30-60 s), so routine maintenance loses nothing.
 */
export const KEEP_FAILED_MS = 10 * 60_000;
/** The same reader viewing the same record from the same client inside this window is one row. */
const COALESCE_MS = 60_000;
/** Recent coalescing keys kept before the oldest are swept. */
const MAX_RECENT = 20_000;
/** How long a SIGTERM waits for the last flush before letting the process go. */
const SHUTDOWN_FLUSH_MS = 5_000;

/** Caps per column, in characters: generous for a real value, small enough that no reader can bloat a row. */
const CAP = {
  id: 256,
  runKind: 64,
  runId: 128,
  recordKind: 64,
  recordId: 512,
  via: 128,
  hash: 64,
  detailKey: 64,
  detailValue: 256,
  detailKeys: 16,
} as const;

type State = {
  pending: Pending[];
  recent: Map<string, number>;
  accounts: Map<string, string | null>;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
  /** Consecutive flushes that found the database not answering; sets the retry backoff. */
  failStreak: number;
  stats: { written: number; dropped: number; coalesced: number };
  autoFlush: boolean;
  /** Whether the exit hooks are registered (once per process). */
  hooked: boolean;
};

const globalForAccessLog = globalThis as unknown as { vocionAccessLog?: State };

function freshState(): State {
  return {
    pending: [],
    recent: new Map(),
    accounts: new Map(),
    timer: null,
    flushing: null,
    failStreak: 0,
    stats: { written: 0, dropped: 0, coalesced: 0 },
    autoFlush: !process.env.VITEST,
    hooked: false,
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

/**
 * A value the database will take: no NUL (Postgres text and jsonb refuse
 * `\u0000`), no lone surrogate (jsonb refuses an unpaired `\uD800`), capped.
 * This is encoding hygiene on an identifier, not a reading of anyone's words.
 * @param value - The raw value.
 * @param cap - The most characters kept.
 */
function clean(value: string, cap: number): string {
  const text = value.replaceAll('\u0000', '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  if (text.length <= cap) {
    return text;
  }
  // Never cut between the two halves of a pair.
  const cut = text.slice(0, cap);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

function cleanOrNull(value: string | null | undefined, cap: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const v = clean(String(value), cap);
  return v === '' ? null : v;
}

/**
 * The envelope as stored: string keys and values cleaned and capped, numbers
 * only when finite, at most {@link CAP.detailKeys} entries. Null when nothing
 * is left.
 * @param detail - The raw envelope.
 */
function cleanDetail(detail: AccessRead['detail']): Record<string, string | number | boolean> | null {
  if (!detail) {
    return null;
  }
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [rawKey, value] of Object.entries(detail)) {
    if (n >= CAP.detailKeys) {
      break;
    }
    const key = clean(rawKey, CAP.detailKey);
    if (!key) {
      continue;
    }
    if (typeof value === 'string') {
      out[key] = clean(value, CAP.detailValue);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        continue;
      }
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else {
      continue;
    }
    n++;
  }
  return n > 0 ? out : null;
}

function actorColumns(actor: AccessActor): Pick<Row, 'actorKind' | 'actorId' | 'onBehalfOf' | 'runKind' | 'runId'> {
  switch (actor.kind) {
    case 'user':
      return { actorKind: 'user', actorId: cleanOrNull(actor.userId, CAP.id), onBehalfOf: null, runKind: null, runId: null };
    case 'agent':
      return {
        actorKind: 'agent',
        actorId: cleanOrNull(actor.agentSlug, CAP.id),
        onBehalfOf: cleanOrNull(actor.onBehalfOf, CAP.id),
        runKind: actor.run ? cleanOrNull(actor.run.kind, CAP.runKind) : null,
        runId: actor.run ? cleanOrNull(String(actor.run.id), CAP.runId) : null,
      };
    case 'token':
      return { actorKind: 'token', actorId: cleanOrNull(actor.tokenId.startsWith('token:') ? actor.tokenId : `token:${actor.tokenId}`, CAP.id), onBehalfOf: null, runKind: null, runId: null };
    case 'link':
      return { actorKind: 'link', actorId: null, onBehalfOf: null, runKind: null, runId: null };
  }
}

/**
 * The row an event becomes, or null for one that names no workspace, no
 * action we know or no kind of record — said once in the log, never written
 * half-formed. Every value is cleaned and capped here, so nothing a reader
 * sends can make the database refuse the batch it rides in.
 * @param event - The read.
 */
export function accessRow(event: AccessEvent): Row | null {
  const orgId = event.orgId ? clean(event.orgId, CAP.id) : '';
  const recordKind = event.record.kind ? clean(event.record.kind, CAP.recordKind).trim() : '';
  if (!orgId || !recordKind || !(ACCESS_ACTIONS as readonly string[]).includes(event.action)) {
    log('warn', 'event refused as malformed', { orgId: orgId || null, action: event.action, recordKind: recordKind || null, via: event.via });
    return null;
  }
  const id = event.record.id;
  return {
    orgId,
    accountId: cleanOrNull(event.accountId, CAP.id),
    ...actorColumns(event.actor),
    action: event.action,
    recordKind,
    recordId: id === null || id === undefined ? null : cleanOrNull(String(id), CAP.recordId),
    via: clean(event.via ?? '', CAP.via) || 'unknown',
    ipHash: cleanOrNull(event.client?.ipHash, CAP.hash),
    uaHash: cleanOrNull(event.client?.uaHash, CAP.hash),
    detail: cleanDetail(event.detail),
    // The moment of the read: a row written after a retry still says when it happened.
    at: event.at ?? new Date(),
  };
}

/**
 * The coalescing key of a view: who (with the client they read from, so two
 * readers of one share link stay two), what, and the workspace. Null for any
 * other action — a search, an export and a download are each kept.
 * @param row - The row.
 */
function coalesceKey(row: Row): string | null {
  if (row.action !== 'view') {
    return null;
  }
  return [row.orgId, row.actorKind, row.actorId, row.onBehalfOf, row.runKind, row.runId, row.ipHash, row.uaHash, row.recordKind, row.recordId]
    .map(v => v ?? '')
    .join('\u0001');
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
 * Flush on the way out. `beforeExit` covers a script or CLI run that simply
 * finishes (the timer is unref'd, so the loop would otherwise end with rows
 * waiting). `SIGTERM` covers a container being stopped: the flush gets
 * {@link SHUTDOWN_FLUSH_MS}, and when nothing else listens for the signal it
 * is raised again afterwards so the process still stops. `exit` cannot wait
 * on I/O, so it only says how many reads never made it.
 * @param s - The log's state.
 */
function hookExit(s: State): void {
  if (s.hooked || !s.autoFlush) {
    return;
  }
  s.hooked = true;
  process.once('beforeExit', () => {
    if (state().pending.length > 0) {
      void flushAccessLog();
    }
  });
  process.once('SIGTERM', () => {
    const letGo = () => {
      if (process.listenerCount('SIGTERM') === 0) {
        process.kill(process.pid, 'SIGTERM');
      }
    };
    const timeout = new Promise<void>(resolve => setTimeout(resolve, SHUTDOWN_FLUSH_MS).unref?.());
    void Promise.race([flushAccessLog().then(() => undefined, () => undefined), timeout]).finally(letGo);
  });
  process.once('exit', () => {
    const left = state().pending.length;
    if (left > 0) {
      log('error', 'process exiting with reads unwritten', { pending: left });
    }
  });
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
    const key = coalesceKey(row);
    if (key && seenRecently(s, key, (row.at as Date).getTime())) {
      s.stats.coalesced += 1;
      return;
    }
    s.pending.push({ row, firstFailedAt: null });
    if (s.pending.length > MAX_PENDING) {
      const over = s.pending.splice(0, s.pending.length - MAX_PENDING);
      s.stats.dropped += over.length;
      log('error', 'buffer full, oldest reads dropped unwritten', { dropped: over.length, pending: s.pending.length });
    }
    hookExit(s);
    if (s.pending.length >= MAX_BATCH && s.autoFlush && s.failStreak === 0) {
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

/** Whether the database answers at all — what tells a refused row from an outage. */
async function databaseAnswers(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put rows back for a later flush after the database did not answer. A row
 * that has been failing for longer than {@link KEEP_FAILED_MS} is dropped,
 * counted and logged instead.
 * @param s - The log's state.
 * @param rows - The rows that were not written.
 * @param error - Why.
 */
function keepForRetry(s: State, rows: Pending[], error: unknown): void {
  const now = Date.now();
  const keep: Pending[] = [];
  let dropped = 0;
  for (const p of rows) {
    p.firstFailedAt ??= now;
    if (now - p.firstFailedAt < KEEP_FAILED_MS) {
      keep.push(p);
    } else {
      dropped++;
    }
  }
  s.pending.unshift(...keep);
  s.stats.dropped += dropped;
  log('error', dropped > 0 ? 'database not answering; reads dropped after the retry window' : 'database not answering; will retry', {
    batch: rows.length,
    retrying: keep.length,
    dropped,
    retryWindowMinutes: KEEP_FAILED_MS / 60_000,
    error: String(error),
  });
}

/**
 * The database is answering but refused the batch: one of its rows is bad.
 * Write them one at a time, so only a row the database refuses on its own is
 * dropped — with an error line saying where it came from — and every other
 * workspace's reads still land. Should the database stop answering partway,
 * the rest go back for a retry rather than being blamed for it.
 * @param s - The log's state.
 * @param batch - The refused batch.
 */
async function writeOneByOne(s: State, batch: Pending[]): Promise<void> {
  const refused: Array<{ via: string; recordKind: string; error: string }> = [];
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i]!;
    try {
      await db.insert(accessEventSchema).values([p.row]);
      s.stats.written += 1;
    } catch (error) {
      if (!(await databaseAnswers())) {
        keepForRetry(s, batch.slice(i), error);
        break;
      }
      s.stats.dropped += 1;
      refused.push({ via: p.row.via, recordKind: p.row.recordKind, error: String(error).slice(0, 200) });
    }
  }
  if (refused.length > 0) {
    log('error', 'the database refused reads on their own; dropped, the rest of the batch written', { dropped: refused.length, batch: batch.length, refused });
  }
}

/**
 * Write one batch.
 * @param s - The log's state.
 * @returns False when the database is not answering (the batch is kept for a retry).
 */
async function writeBatch(s: State): Promise<boolean> {
  const batch = s.pending.splice(0, MAX_BATCH);
  if (batch.length === 0) {
    return true;
  }
  const rows = batch.map(p => p.row);
  try {
    await withAccounts(s, rows);
    await db.insert(accessEventSchema).values(rows);
    s.stats.written += batch.length;
    return true;
  } catch (error) {
    if (await databaseAnswers()) {
      await writeOneByOne(s, batch);
      return true;
    }
    keepForRetry(s, batch, error);
    return false;
  }
}

/**
 * Write everything buffered now. Stops at a batch the database did not answer
 * for (the rest waits rather than hammering a database that is down) and
 * schedules the retry itself, backing off up to {@link MAX_RETRY_DELAY_MS}.
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
        s.failStreak += 1;
        schedule(s, Math.min(FLUSH_DELAY_MS * 2 ** s.failStreak, MAX_RETRY_DELAY_MS));
        return;
      }
      s.failStreak = 0;
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
 * @param opts - What a test wants switched on.
 * @param opts.autoFlush - Write on the timer, as production does.
 * @param opts.hooks - Register the exit hooks on the next read, as production does.
 */
export function resetAccessLogForTests(opts: { autoFlush?: boolean; hooks?: boolean } = {}): void {
  const s = state();
  if (s.timer) {
    clearTimeout(s.timer);
  }
  globalForAccessLog.vocionAccessLog = { ...freshState(), autoFlush: opts.autoFlush ?? false, hooked: !opts.hooks };
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
  /**
   * How many reads were noted under this scope, counted by {@link noteRead}.
   * The tool-call recorder reads it to know whether a tool already said what
   * it read before writing the tool's declared read itself.
   */
  noted?: number;
};

const scopes = new AsyncLocalStorage<AccessScope>();

/**
 * Run `fn` with a reader in scope, so a {@link noteRead} anywhere beneath it —
 * however deep, across awaits — is recorded as that reader's.
 * @param scope - Who is reading, and where. Its `noted` count is kept on this object.
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
  scope.noted = (scope.noted ?? 0) + 1;
  const { noted: _noted, ...who } = scope;
  recordAccess({ ...who, ...read });
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
    const client = headers ? clientOf(headers, viewer.orgId) : await currentRequestClient(viewer.orgId);
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
  recordAccess({ ...read, orgId: caller.orgId, actor, client: clientOf(headers, caller.orgId) });
}

/**
 * A read through a public share link: nobody signed in, the link is the
 * credential. The fingerprint is all there is to tell two readers apart, so
 * it is part of what keeps their views separate rows.
 * @param orgId - The workspace the shared thing belongs to.
 * @param read - What was read, and through which surface.
 * @param headers - The request's headers, when the caller holds them.
 */
export async function noteLinkRead(orgId: string, read: AccessRead & { via: string }, headers?: Pick<Headers, 'get'> | null): Promise<void> {
  try {
    const client = headers ? clientOf(headers, orgId) : await currentRequestClient(orgId);
    recordAccess({ ...read, orgId, actor: { kind: 'link' }, client });
  } catch (error) {
    log('error', 'could not note a share-link read', { via: read.via, error: String(error) });
  }
}
