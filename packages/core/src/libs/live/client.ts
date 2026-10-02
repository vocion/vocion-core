import type { LiveNotice } from './topics';
import { MAX_LIVE_TOPICS, noticeMatches } from './topics';

/**
 * THE BROWSER'S SIDE OF THE LIVE STREAM (backlog 050): one connection per
 * tab, however many things on the page follow something.
 *
 * Each follower (`useLive`) says which topics it wants and what to do when
 * one changes; this keeps ONE `EventSource` on `/api/v1/live` open for the
 * union of them, and hands each notice to the followers it concerns. When the
 * set changes — a card mounts, a pane closes — the connection is replaced
 * with one for the new set, resuming after the last notice it had, so the
 * swap loses nothing.
 *
 * States, which a follower reads to decide whether to fall back to polling:
 *
 * - `open` — notices arrive as changes commit; nothing needs to poll.
 * - `paused` — the tab has been hidden a while and the connection is closed;
 *   coming back reconnects and replays what was missed, so nothing polls.
 * - `connecting`, `down` — no stream (yet, or any more). A follower polls
 *   the way it did before the stream existed until `open` comes back. `down`
 *   retries itself with backoff.
 */

export type LiveState = 'idle' | 'connecting' | 'open' | 'paused' | 'down';

export type LiveListener = {
  topics: ReadonlySet<string>;
  onNotice: (notice: LiveNotice) => void;
};

type EventSourceLike = Pick<EventSource, 'addEventListener' | 'close' | 'readyState'> & { onerror: ((e: Event) => void) | null };

export type LiveClientOptions = {
  url?: string;
  /** The EventSource to use (tests). */
  EventSource?: new (url: string, init?: EventSourceInit) => EventSourceLike;
  /** How long a hidden tab keeps its stream before letting it go. */
  hiddenGraceMs?: number;
  /** How long a burst of mounts is gathered before the connection is replaced. */
  settleMs?: number;
  /** When this page loaded, epoch ms: a first connection replays what changed since. */
  loadedAt?: number;
  /** Whether the document is visible (tests). */
  visible?: () => boolean;
};

const CLOSED = 2;

export class LiveClient {
  private readonly listeners = new Set<LiveListener>();
  private readonly watchers = new Set<() => void>();
  private source: EventSourceLike | null = null;
  private sourceKey = '';
  private lastId = 0;
  private readonly seen = new Set<number>();
  private state: LiveState = 'idle';
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastOpenAt: number | null = null;
  private hiddenClosed = false;
  private readonly url: string;
  private readonly ES: NonNullable<LiveClientOptions['EventSource']>;
  private readonly visible: () => boolean;

  constructor(private readonly opts: LiveClientOptions = {}) {
    this.url = opts.url ?? '/api/v1/live';
    this.ES = opts.EventSource ?? (globalThis.EventSource as unknown as NonNullable<LiveClientOptions['EventSource']>);
    this.visible = opts.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
    if (typeof document !== 'undefined' && !opts.visible) {
      document.addEventListener('visibilitychange', () => this.onVisibility());
    }
  }

  /** The connection's state now. */
  getState(): LiveState {
    return this.state;
  }

  /**
   * Be told when the state changes (`useSyncExternalStore`).
   * @param onChange - Called on every change.
   */
  watch(onChange: () => void): () => void {
    this.watchers.add(onChange);
    return () => this.watchers.delete(onChange);
  }

  /**
   * Follow some topics until the returned function is called.
   * @param listener - What to follow and what to do.
   */
  add(listener: LiveListener): () => void {
    this.listeners.add(listener);
    this.settle();
    return () => {
      this.listeners.delete(listener);
      this.settle();
    };
  }

  private setState(next: LiveState): void {
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const w of [...this.watchers]) {
      w();
    }
  }

  private topics(): string[] {
    const all = new Set<string>();
    for (const l of this.listeners) {
      for (const t of l.topics) {
        all.add(t);
      }
    }
    return [...all].sort();
  }

  private settle(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.reconcile();
    }, this.opts.settleMs ?? 30);
  }

  private reconcile(): void {
    const topics = this.topics();
    if (topics.length === 0) {
      this.close();
      this.setState('idle');
      return;
    }
    if (this.hiddenClosed) {
      return;
    }
    const key = topics.join(',');
    if (this.source && key === this.sourceKey) {
      return;
    }
    this.open(topics);
  }

  private close(): void {
    this.source?.close();
    this.source = null;
    this.sourceKey = '';
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private open(wanted: string[]): void {
    if (typeof this.ES !== 'function') {
      this.setState('down');
      return;
    }
    const swapping = this.state === 'open';
    this.close();
    if (wanted.length > MAX_LIVE_TOPICS) {
      // Said, not hidden: what is past the budget is not carried.
      console.warn(`[live] this tab follows ${wanted.length} topics; the stream carries the first ${MAX_LIVE_TOPICS}`);
    }
    const topics = wanted.slice(0, MAX_LIVE_TOPICS);
    const params = new URLSearchParams({ topics: topics.join(',') });
    if (this.lastId > 0) {
      params.set('after', String(this.lastId));
    } else {
      params.set('since', String(this.lastOpenAt ?? this.opts.loadedAt ?? Date.now()));
    }
    const es = new this.ES(`${this.url}?${params.toString()}`, { withCredentials: true });
    this.source = es;
    this.sourceKey = wanted.join(',');
    // Replacing an open stream with one for a bigger set is not an outage:
    // followers keep treating the stream as up while the new one opens.
    if (!swapping) {
      this.setState('connecting');
    }
    es.addEventListener('ready', (e) => {
      if (this.source !== es) {
        return;
      }
      this.failures = 0;
      this.lastOpenAt = Date.now();
      this.setState('open');
      const ready = safeJson((e as MessageEvent).data) as { refused?: Array<{ topic: string; reason: string }> } | null;
      if (ready?.refused && ready.refused.length > 0) {
        console.warn('[live] some topics are not followed here', ready.refused);
      }
    });
    es.addEventListener('notice', (e) => {
      if (this.source !== es) {
        return;
      }
      const n = safeJson((e as MessageEvent).data) as LiveNotice | null;
      if (n && typeof n.id === 'number' && Array.isArray(n.topics)) {
        this.receive(n);
      }
    });
    es.addEventListener('reset', () => {
      if (this.source === es) {
        this.resync();
      }
    });
    es.onerror = () => {
      if (this.source !== es) {
        return;
      }
      this.setState('down');
      if (es.readyState === CLOSED) {
        // Refused or unreachable: the browser will not retry this one, so we do.
        this.source = null;
        this.sourceKey = '';
        this.failures += 1;
        const wait = Math.min(60_000, 2_000 * 2 ** Math.min(this.failures - 1, 5));
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.reconcile();
        }, wait);
      }
    };
  }

  /**
   * Hand one notice to the followers it concerns, once.
   * @param n - The notice.
   */
  receive(n: LiveNotice): void {
    this.lastId = Math.max(this.lastId, n.id);
    if (this.seen.has(n.id)) {
      return;
    }
    this.seen.add(n.id);
    if (this.seen.size > 2048) {
      this.seen.delete(this.seen.values().next().value as number);
    }
    for (const l of [...this.listeners]) {
      if (noticeMatches(n, l.topics)) {
        try {
          l.onNotice(n);
        } catch (err) {
          console.warn('[live] a follower failed on a notice', err);
        }
      }
    }
  }

  /** The stream could not replay a gap: every follower reads what it shows again. */
  resync(): void {
    const at = new Date().toISOString();
    for (const l of [...this.listeners]) {
      l.onNotice({ id: 0, topics: [...l.topics], ref: 'resync', kind: 'resync', at });
    }
  }

  private onVisibility(): void {
    if (this.visible()) {
      if (this.hiddenTimer) {
        clearTimeout(this.hiddenTimer);
        this.hiddenTimer = null;
      }
      if (this.hiddenClosed) {
        this.hiddenClosed = false;
        this.reconcile();
      }
      return;
    }
    // A tab left in the background lets its stream go after a grace period;
    // coming back reconnects and replays from the last notice it had.
    this.hiddenTimer ??= setTimeout(() => {
      this.hiddenTimer = null;
      if (!this.visible() && this.source) {
        this.close();
        this.hiddenClosed = true;
        this.setState('paused');
      }
    }, this.opts.hiddenGraceMs ?? 30_000);
  }

  /** Visibility changed (tests drive this; the browser's event calls it too). */
  visibilityChanged(): void {
    this.onVisibility();
  }
}

/**
 * Parse an event's data, or null.
 * @param data - The data.
 */
function safeJson(data: unknown): unknown {
  try {
    return typeof data === 'string' ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

let shared: LiveClient | null = null;

/** This tab's one connection. */
export function liveClient(): LiveClient {
  shared ??= new LiveClient({ loadedAt: typeof performance !== 'undefined' ? Math.round(performance.timeOrigin) : Date.now() });
  return shared;
}
