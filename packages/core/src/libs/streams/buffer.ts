/**
 * Resumable stream buffer — the missing half of chat streaming reliability.
 *
 * The SSE route already KEEPS GENERATING when the client drops (safeEnqueue
 * swallows writes) and persists the finished turn; what was lost was the live
 * stream itself: refresh/phone-lock mid-turn meant no tokens until the run
 * finished and the page rehydrated. This buffer fixes that: every event of an
 * active turn is retained per streamId, so a reconnecting client REPLAYS what
 * it missed and re-attaches live, mid-turn.
 *
 * Scope: in-process (Vocion deploys as a single app container; dev is a single
 * Next process). If the app ever scales horizontally, swap this Map for Redis
 * behind the same interface. TTL-swept; bounded per stream.
 */

type Subscriber = (data: string) => void;

type BufferedStream = {
  events: string[];
  done: boolean;
  updatedAt: number;
  subscribers: Set<Subscriber>;
  /**
   * The person pressed Stop on this turn (#114).
   *
   * Stopping aborts the browser's fetch, which looks exactly like a phone
   * locking or a tab refreshing — and those must NOT end the turn, because the
   * run keeps going and the client comes back through `resume`. So the client
   * says so out loud (`/rpc/agent/stream/stop`), and the flag lands here
   * because this is already the per-turn state the route and the resume path
   * share.
   */
  stopped: boolean;
  /**
   * Whose turn this is — the org and person the SSE route authenticated.
   *
   * A stream id is a v4 UUID and hard to guess, but "hard to guess" is not a
   * permission: ids travel in logs, screenshots and bug reports. Anything that
   * acts on somebody's running turn has to prove it belongs to them first.
   */
  owner: { orgId: string; userId: string };
};

const streams = new Map<string, BufferedStream>();
const TTL_MS = 15 * 60_000; // a finished/abandoned stream is replayable for 15 min
const MAX_EVENTS = 5000; // runaway guard (~ a very long turn)

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of streams) {
    if (now - s.updatedAt > TTL_MS) {
      streams.delete(id);
    }
  }
}

/**
 * Open a new buffered stream for a turn. Returns append/close bound to it.
 * @param id
 * @param owner
 * @param owner.orgId
 * @param owner.userId
 */
export function openStream(id: string, owner: { orgId: string; userId: string }): { append: (data: string) => void; close: () => void } {
  sweep();
  const s: BufferedStream = { events: [], done: false, updatedAt: Date.now(), subscribers: new Set(), stopped: false, owner };
  streams.set(id, s);
  return {
    append: (data: string) => {
      if (s.events.length < MAX_EVENTS) {
        s.events.push(data);
      }
      s.updatedAt = Date.now();
      for (const sub of s.subscribers) {
        sub(data);
      }
    },
    close: () => {
      s.done = true;
      s.updatedAt = Date.now();
      for (const sub of s.subscribers) {
        sub('__DONE__');
      }
      s.subscribers.clear();
    },
  };
}

/**
 * Attach to a stream: replay everything buffered so far (from `after`, a
 * 0-based count of events the client already has), then live events until
 * done.
 *
 * Returns null when the stream is unknown, expired, or belongs to somebody
 * else — all three the same way, because a caller must not be able to learn
 * that a given stream id exists. A buffered stream holds the whole text of
 * someone's conversation, so `by` is a permission check, not a formality: the
 * id alone is not authority to read it.
 * @param id - The stream id.
 * @param by - Who is asking; must be the person the turn was started for.
 * @param by.orgId
 * @param by.userId
 * @param after - How many events the client already has.
 * @param onEvent - Called with each event, replayed then live.
 * @param onDone - Called once the turn finishes.
 * @returns A detach function, or null when there is nothing this person may attach to.
 */
export function attachStream(
  id: string,
  by: { orgId: string; userId: string },
  after: number,
  onEvent: (data: string) => void,
  onDone: () => void,
): (() => void) | null {
  const s = streams.get(id);
  if (!s || s.owner.orgId !== by.orgId || s.owner.userId !== by.userId) {
    return null;
  }
  for (let i = Math.max(0, after); i < s.events.length; i++) {
    onEvent(s.events[i]!);
  }
  if (s.done) {
    onDone();
    return () => {};
  }
  const sub: Subscriber = (data) => {
    if (data === '__DONE__') {
      onDone();
    } else {
      onEvent(data);
    }
  };
  s.subscribers.add(sub);
  return () => s.subscribers.delete(sub);
}

/**
 * Is this stream still known to this person — replayable or live?
 *
 * Owner-scoped like everything else here, and for the same reason: answering
 * "yes, that stream exists" for somebody else's turn turns any endpoint that
 * calls this into an oracle for guessing ids.
 * @param id - The stream id.
 * @param by - Who is asking; must be the person the turn was started for.
 * @param by.orgId
 * @param by.userId
 * @returns True only when that person has a stream by this id.
 */
export function hasStream(id: string, by: { orgId: string; userId: string }): boolean {
  sweep();
  const s = streams.get(id);
  return s !== undefined && s.owner.orgId === by.orgId && s.owner.userId === by.userId;
}

/**
 * Record that the person stopped this turn on purpose.
 *
 * Called from `/rpc/agent/stream/stop` while the run is still going. Unknown
 * ids, expired ids and ids belonging to somebody else are all ignored the same
 * way — a caller learns only that nothing was stopped, never whose turn it was.
 * @param id - The turn's stream id, as the first `stream_meta` frame gave it.
 * @param by - Who is asking; must be the person the turn was started for.
 * @param by.orgId
 * @param by.userId
 * @returns True when that person's live stream was marked, false otherwise.
 */
export function markStopped(id: string, by: { orgId: string; userId: string }): boolean {
  const s = streams.get(id);
  // Somebody else's turn is not theirs to end, however they came by the id.
  if (!s || s.owner.orgId !== by.orgId || s.owner.userId !== by.userId) {
    return false;
  }
  // A stream that is `done` is deliberately still markable: the route closes
  // the buffer BEFORE it writes the row, so a stop landing in that gap still
  // reaches the row it is about.
  s.stopped = true;
  s.updatedAt = Date.now();
  return true;
}

/**
 * Did the person stop this turn?
 * @param id - The turn's stream id.
 * @returns True only when a stop was recorded for a stream still in memory.
 */
export function wasStopped(id: string): boolean {
  return streams.get(id)?.stopped === true;
}
