import type { LiveNotice } from './topics';
import type { LiveTransport, LiveWire } from './transport';
import { and, arrayOverlaps, desc, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { db as defaultDb } from '@/libs/DB';
import { liveNoticeSchema } from '@/models/Schema';
import { noticeMatches } from './topics';
import { defaultTransport, isoAt } from './transport';

/**
 * ONE PROCESS'S SIDE OF THE LIVE STREAM (backlog 050).
 *
 * Every open `GET /api/v1/live` in this process is a subscriber here. The hub
 * hears the ring once (`transport.ts`) and hands each notice to the
 * subscribers of that workspace following one of its topics. It also:
 *
 * - **reads the ring itself** — every {@link TAIL_SLOW_MS} while the doorbell
 *   works, every {@link TAIL_FAST_MS} while it is out or this database cannot
 *   push. So a notice rung while a listener was reconnecting still arrives,
 *   just later; nothing is lost silently.
 * - **replays** for a reconnecting tab: the notices since its
 *   `Last-Event-ID`, or since it loaded, from the ring.
 * - **prunes** the ring to {@link RETENTION_MS}.
 *
 * Ids come from a sequence, and a transaction that took an id early can
 * commit after one that took a later id. Every read therefore looks back
 * {@link SLACK} ids behind the newest it delivered and skips what it has
 * seen, so a straggler is delivered rather than stepped over. A notice is an
 * instruction to re-read, so hearing one twice costs a read, never a wrong
 * screen.
 */

/** How far behind the newest delivered id every read looks, for stragglers. */
export const SLACK = 200;
/** How long the ring keeps a notice: a tab away longer than this re-reads everything. */
export const RETENTION_MS = 60 * 60_000;
/** How often the ring is read while the doorbell works — the safety net. */
export const TAIL_SLOW_MS = 15_000;
/** How often the ring is read while it does not. */
export const TAIL_FAST_MS = 1_000;
/** The most a replay sends before telling the tab to re-read everything instead. */
export const REPLAY_LIMIT = 500;
/** How long a hub with nobody subscribed keeps listening before it lets go. */
const IDLE_STOP_MS = 60_000;
const PRUNE_EVERY_MS = 5 * 60_000;

type Db = typeof defaultDb;

/** One open stream. */
export type LiveSubscriber = {
  orgId: string;
  topics: ReadonlySet<string>;
  send: (notice: LiveNotice) => void;
};

type Row = typeof liveNoticeSchema.$inferSelect;

/**
 * A ring row as a follower receives it.
 * @param r - The row.
 */
function toNotice(r: Pick<Row, 'id' | 'topics' | 'ref' | 'kind' | 'createdAt'>): LiveNotice {
  return { id: Number(r.id), topics: r.topics, ref: r.ref, kind: r.kind, at: isoAt(r.createdAt) };
}

/** A set that forgets its oldest entries past a size. */
class Recent {
  private readonly ids = new Set<number>();
  constructor(private readonly cap: number) {}
  has(id: number): boolean {
    return this.ids.has(id);
  }

  add(id: number): void {
    this.ids.add(id);
    if (this.ids.size > this.cap) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) {
        this.ids.delete(oldest);
      }
    }
  }
}

export class LiveHub {
  private readonly subs = new Set<LiveSubscriber>();
  private readonly seen = new Recent(8192);
  private cursor = 0;
  private transport: LiveTransport | null = null;
  private starting: Promise<void> | null = null;
  private pushing = false;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPrune = 0;
  private reading = false;
  /** Why the doorbell is out, when it is — said by `state()`. */
  private downReason: string | null = null;

  constructor(private readonly opts: { db?: Db; transport?: () => LiveTransport; tailFastMs?: number; tailSlowMs?: number } = {}) {}

  private get db(): Db {
    return this.opts.db ?? defaultDb;
  }

  /** How this hub is hearing the ring, for the stream's `ready` event and the logs. */
  state(): { transport: string | null; pushing: boolean; reason: string | null; subscribers: number } {
    return { transport: this.transport?.name ?? null, pushing: this.pushing, reason: this.downReason, subscribers: this.subs.size };
  }

  /**
   * Follow topics in one workspace until the returned function is called.
   * @param sub - The subscriber.
   * @returns Unsubscribe.
   */
  subscribe(sub: LiveSubscriber): () => void {
    this.subs.add(sub);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.ready().catch((err: unknown) => {
      console.warn('[live] could not start hearing the ring', { error: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      this.subs.delete(sub);
      if (this.subs.size === 0 && !this.idleTimer) {
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null;
          if (this.subs.size === 0) {
            void this.stop();
          }
        }, IDLE_STOP_MS);
      }
    };
  }

  /** Start hearing the ring, once. Resolves when the hub is listening or reading. */
  ready(): Promise<void> {
    // A start that failed (the database was unreachable) is tried again by
    // the next caller rather than remembered as the answer.
    this.starting ??= this.start().catch((err: unknown) => {
      this.starting = null;
      throw err;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const [top] = await this.db.select({ id: liveNoticeSchema.id }).from(liveNoticeSchema).orderBy(desc(liveNoticeSchema.id)).limit(1);
    this.cursor = Math.max(this.cursor, Number(top?.id ?? 0));
    const transport = (this.opts.transport ?? defaultTransport)();
    this.transport = transport;
    try {
      await transport.start({
        notice: wire => void this.onWire(wire),
        down: (reason) => {
          this.pushing = false;
          this.downReason = reason;
          console.warn('[live] the doorbell is out; reading the ring every second until it is back', { transport: transport.name, reason });
          this.schedule(0);
        },
        up: () => {
          this.pushing = true;
          this.downReason = null;
          this.schedule(0);
        },
      });
      this.pushing = true;
      this.downReason = null;
    } catch (err) {
      this.pushing = false;
      this.downReason = err instanceof Error ? err.message : String(err);
      console.warn('[live] this database cannot push; reading the ring every second instead', { transport: transport.name, reason: this.downReason });
    }
    this.schedule(this.pushing ? this.slowMs : this.fastMs);
  }

  /** Stop hearing the ring. The next subscriber starts it again. */
  async stop(): Promise<void> {
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
      this.tailTimer = null;
    }
    const t = this.transport;
    this.transport = null;
    this.starting = null;
    this.pushing = false;
    await t?.stop().catch(() => {});
  }

  private get fastMs(): number {
    return this.opts.tailFastMs ?? TAIL_FAST_MS;
  }

  private get slowMs(): number {
    return this.opts.tailSlowMs ?? TAIL_SLOW_MS;
  }

  private schedule(ms: number): void {
    if (!this.transport) {
      return;
    }
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
    }
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null;
      void this.readRing().finally(() => this.schedule(this.pushing ? this.slowMs : this.fastMs));
    }, ms);
  }

  private async onWire(wire: Partial<LiveWire> & { id: number; orgId: string }): Promise<void> {
    if (this.seen.has(wire.id)) {
      return;
    }
    if (wire.topics && wire.ref && wire.kind) {
      this.deliver(wire.orgId, { id: wire.id, topics: wire.topics, ref: wire.ref, kind: wire.kind, at: wire.at ?? new Date().toISOString() });
      return;
    }
    // A payload too big for NOTIFY carried only its id: read the row.
    const [row] = await this.db.select().from(liveNoticeSchema).where(eq(liveNoticeSchema.id, wire.id)).limit(1);
    if (row) {
      this.deliver(row.orgId, toNotice(row));
    }
  }

  /**
   * Hand one notice to every subscriber in its workspace following one of its topics.
   * @param orgId - Whose notice it is.
   * @param notice - The notice.
   */
  deliver(orgId: string, notice: LiveNotice): void {
    if (this.seen.has(notice.id)) {
      return;
    }
    this.seen.add(notice.id);
    this.cursor = Math.max(this.cursor, notice.id);
    for (const sub of this.subs) {
      if (sub.orgId === orgId && noticeMatches(notice, sub.topics)) {
        try {
          sub.send(notice);
        } catch (err) {
          console.warn('[live] a subscriber could not take a notice', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  /** Read what the ring holds past the cursor (less the slack) and deliver what was not seen. */
  async readRing(): Promise<void> {
    if (this.reading) {
      return;
    }
    this.reading = true;
    try {
      const rows = await this.db
        .select()
        .from(liveNoticeSchema)
        .where(gt(liveNoticeSchema.id, Math.max(0, this.cursor - SLACK)))
        .orderBy(liveNoticeSchema.id)
        .limit(2000);
      for (const r of rows) {
        this.deliver(r.orgId, toNotice(r));
      }
      await this.prune();
    } catch (err) {
      console.warn('[live] could not read the ring', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.reading = false;
    }
  }

  private async prune(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) {
      return;
    }
    this.lastPrune = now;
    await this.db.delete(liveNoticeSchema).where(lt(liveNoticeSchema.createdAt, new Date(now - RETENTION_MS)));
  }

  /**
   * What a (re)connecting tab missed, from the ring.
   *
   * After an id (its `Last-Event-ID`): every notice past it, less the slack,
   * for its topics — or `reset` when the ring no longer holds that far back,
   * or holds more than a replay should send, and the tab should re-read
   * everything it shows instead. Since a moment (a tab's first connection,
   * with the time it loaded): the notices written since, a little before,
   * bounded to two minutes.
   * @param orgId - The workspace.
   * @param topics - What the tab follows.
   * @param from - Where to replay from.
   * @param from.afterId - The last notice the tab received.
   * @param from.sinceMs - When the tab loaded (epoch ms).
   */
  async replay(orgId: string, topics: readonly string[], from: { afterId?: number; sinceMs?: number }): Promise<{ notices: LiveNotice[]; reset: boolean }> {
    if (topics.length === 0) {
      return { notices: [], reset: false };
    }
    const scope = and(eq(liveNoticeSchema.orgId, orgId), arrayOverlaps(liveNoticeSchema.topics, [...topics]));
    if (from.afterId !== undefined && from.afterId > 0) {
      const [oldest] = await this.db.select({ id: sql<number>`min(${liveNoticeSchema.id})` }).from(liveNoticeSchema);
      const oldestId = Number(oldest?.id ?? 0);
      if (oldestId > 0 && from.afterId < oldestId - 1) {
        return { notices: [], reset: true };
      }
      const rows = await this.db
        .select()
        .from(liveNoticeSchema)
        .where(and(scope, gt(liveNoticeSchema.id, Math.max(0, from.afterId - SLACK))))
        .orderBy(liveNoticeSchema.id)
        .limit(REPLAY_LIMIT + 1);
      if (rows.length > REPLAY_LIMIT) {
        return { notices: [], reset: true };
      }
      return { notices: rows.map(toNotice), reset: false };
    }
    if (from.sinceMs !== undefined && Number.isFinite(from.sinceMs)) {
      const since = Math.max(from.sinceMs - 2_000, Date.now() - 2 * 60_000);
      const rows = await this.db
        .select()
        .from(liveNoticeSchema)
        .where(and(scope, gte(liveNoticeSchema.createdAt, new Date(since))))
        .orderBy(liveNoticeSchema.id)
        .limit(REPLAY_LIMIT);
      return { notices: rows.map(toNotice), reset: false };
    }
    return { notices: [], reset: false };
  }
}

const globalForLive = globalThis as unknown as { vocionLiveHub?: LiveHub };

/**
 * This process's hub. One per process, kept on `globalThis` for the same two
 * reasons the database handle is (`libs/DB.ts`): hot reload, and a module
 * bundled into more than one server chunk.
 */
export function liveHub(): LiveHub {
  globalForLive.vocionLiveHub ??= new LiveHub();
  return globalForLive.vocionLiveHub;
}
