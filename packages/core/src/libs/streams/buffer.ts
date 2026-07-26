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
  const s: BufferedStream = { events: [], done: false, updatedAt: Date.now(), subscribers: new Set() };
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
