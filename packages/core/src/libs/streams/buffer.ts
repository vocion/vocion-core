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
 */
export function openStream(id: string): { append: (data: string) => void; close: () => void } {
  sweep();
  const s: BufferedStream = { events: [], done: false, updatedAt: Date.now(), subscribers: new Set(), stopped: false };
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
 * done. Returns null when the stream is unknown/expired.
 * @param id
 * @param after
 * @param onEvent
 * @param onDone
 */
export function attachStream(
  id: string,
  after: number,
  onEvent: (data: string) => void,
  onDone: () => void,
): (() => void) | null {
  const s = streams.get(id);
  if (!s) {
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
 * Is this stream still known (replayable or live)?
 * @param id
 */
export function hasStream(id: string): boolean {
  sweep();
  return streams.has(id);
}

/**
 * Record that the person stopped this turn on purpose.
 *
 * Called from `/rpc/agent/stream/stop` while the run is still going. Unknown
 * or expired ids are ignored: a stop that arrives after the turn already
 * finished has nothing left to describe.
 * @param id - The turn's stream id, as the first `stream_meta` frame gave it.
 * @returns True when a live stream was marked, false when there was none.
 */
export function markStopped(id: string): boolean {
  const s = streams.get(id);
  if (!s) {
    return false;
  }
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
