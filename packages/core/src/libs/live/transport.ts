import type { LiveNotice } from './topics';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';

/**
 * HOW A PROCESS HEARS THE RING (backlog 050).
 *
 * Every notice is a `live_notice` row whose insert rings
 * `pg_notify('vocion_live')` (migration 0155). A transport is what turns that
 * doorbell into calls on the hub. Three exist, chosen by what the database
 * can do (`defaultTransport`):
 *
 * - **Postgres** (production, the local docker Postgres): a dedicated
 *   connection that `LISTEN`s, reconnecting itself with backoff. It spans
 *   processes — the worker's commit is heard by every app container.
 * - **PGlite in process** (the unit tests, the hosted demo): PGlite's own
 *   `listen`, which the same triggers ring.
 * - **None** — a single-connection server (the `pglite-server` that
 *   `npm run dev` boots accepts one client at a time, so a second, listening
 *   connection would queue behind the app's pool forever). The hub then
 *   reads the ring on a short interval instead, which is the same rows,
 *   a second later.
 *
 * Whatever the transport, the hub also reads the ring on a slow interval and
 * whenever the doorbell was out, so a notice rung while a listener was
 * reconnecting is still delivered. The ring is the truth; NOTIFY only makes
 * it prompt.
 */

/** A notice as it crosses the process boundary: the notice, and whose it is. */
export type LiveWire = LiveNotice & { orgId: string };

/** What a transport calls. */
export type LiveSink = {
  /** A notice was rung. `topics` may be missing (a payload over NOTIFY's limit): the hub reads the row. */
  notice: (wire: Partial<LiveWire> & { id: number; orgId: string }) => void;
  /** The doorbell is out — pushes may be missed until `up`. */
  down: (reason: string) => void;
  /** The doorbell is back; the hub reads what it missed. */
  up: () => void;
};

export type LiveTransport = {
  readonly name: string;
  /** Start delivering. Rejects when this database cannot push, and the hub reads the ring instead. */
  start: (sink: LiveSink) => Promise<void>;
  stop: () => Promise<void>;
};

/** The channel the ring's trigger notifies. */
export const LIVE_CHANNEL = 'vocion_live';

/**
 * Read a NOTIFY payload, or null when it is not one of ours.
 * @param payload - The raw payload.
 */
export function parseWire(payload: string): (Partial<LiveWire> & { id: number; orgId: string }) | null {
  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    const id = Number(raw.id);
    if (!Number.isSafeInteger(id) || id <= 0 || typeof raw.orgId !== 'string') {
      return null;
    }
    return {
      id,
      orgId: raw.orgId,
      ...(Array.isArray(raw.topics) ? { topics: raw.topics.map(String) } : {}),
      ...(typeof raw.ref === 'string' ? { ref: raw.ref } : {}),
      ...(typeof raw.kind === 'string' ? { kind: raw.kind } : {}),
      ...(raw.at !== undefined && raw.at !== null ? { at: isoAt(raw.at) } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * A `timestamp` column's value as ISO. The column carries no zone and is
 * written in UTC (as every timestamp here is); JSON from Postgres drops the
 * `Z`, so it goes back on.
 * @param at - What the database said.
 */
export function isoAt(at: unknown): string {
  if (at instanceof Date) {
    return at.toISOString();
  }
  const s = String(at);
  const zoned = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(s) ? s : `${s}Z`;
  const d = new Date(zoned);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * PGlite in process: its own `listen`.
 * @param client - The PGlite instance behind the drizzle handle.
 * @param client.listen - PGlite's listen.
 */
export function pgliteTransport(client: { listen: (channel: string, cb: (payload: string) => void) => Promise<() => Promise<void>> }): LiveTransport {
  let unlisten: (() => Promise<void>) | null = null;
  return {
    name: 'pglite',
    async start(sink) {
      unlisten = await client.listen(LIVE_CHANNEL, (payload) => {
        const wire = parseWire(payload);
        if (wire) {
          sink.notice(wire);
        }
      });
    },
    async stop() {
      const u = unlisten;
      unlisten = null;
      await u?.().catch(() => {});
    },
  };
}

/**
 * Postgres: one dedicated connection that LISTENs, and reconnects itself.
 * @param connectionString - The database URL.
 */
export function postgresTransport(connectionString: string): LiveTransport {
  let client: Client | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1_000;
  let sink: LiveSink | null = null;

  const scheduleReconnect = (reason: string) => {
    if (stopped || retry) {
      return;
    }
    sink?.down(reason);
    retry = setTimeout(() => {
      retry = null;
      connect().then(() => {
        backoff = 1_000;
        sink?.up();
      }).catch((err: unknown) => scheduleReconnect(err instanceof Error ? err.message : String(err)));
    }, backoff);
    backoff = Math.min(30_000, backoff * 2);
  };

  async function connect(): Promise<void> {
    const c = new Client({ connectionString, connectionTimeoutMillis: 5_000, keepAlive: true });
    c.on('notification', (msg) => {
      if (msg.channel !== LIVE_CHANNEL || !msg.payload) {
        return;
      }
      const wire = parseWire(msg.payload);
      if (wire) {
        sink?.notice(wire);
      }
    });
    const lost = (reason: string) => {
      if (client !== c) {
        return;
      }
      client = null;
      c.end().catch(() => {});
      scheduleReconnect(reason);
    };
    c.on('error', err => lost(err.message));
    c.on('end', () => lost('connection ended'));
    try {
      await c.connect();
      await c.query(`LISTEN ${LIVE_CHANNEL}`);
    } catch (err) {
      c.end().catch(() => {});
      throw err;
    }
    client = c;
  }

  return {
    name: 'postgres',
    async start(s) {
      sink = s;
      stopped = false;
      // A single-connection server (pglite-server, `npm run dev`) would queue
      // this connection behind the app's own and never answer. Asked through
      // the app's pool, which is already connected.
      const version = await db.execute(sql`select version() as v`);
      const v = String((version as unknown as { rows: Array<{ v: unknown }> }).rows[0]?.v ?? '');
      if (/emscripten/i.test(v)) {
        throw new Error('this database is PGlite behind a single-connection server; reading the ring instead of listening');
      }
      await connect();
    },
    async stop() {
      stopped = true;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      const c = client;
      client = null;
      await c?.end().catch(() => {});
    },
  };
}

/**
 * The transport this process uses: PGlite's own when the database is PGlite
 * in process, a listening connection otherwise.
 */
export function defaultTransport(): LiveTransport {
  const client = (db as unknown as { $client?: { listen?: unknown } }).$client;
  if (client && typeof client.listen === 'function') {
    return pgliteTransport(client as Parameters<typeof pgliteTransport>[0]);
  }
  return postgresTransport(Env.DATABASE_URL);
}

/**
 * A transport a test rings by hand.
 */
export function memoryTransport(): LiveTransport & { ring: (wire: LiveWire) => void; drop: (reason: string) => void; restore: () => void } {
  let sink: LiveSink | null = null;
  return {
    name: 'memory',
    async start(s) {
      sink = s;
    },
    async stop() {
      sink = null;
    },
    ring: wire => sink?.notice(wire),
    drop: reason => sink?.down(reason),
    restore: () => sink?.up(),
  };
}
