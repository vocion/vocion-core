/**
 * The composer's SEND QUEUE — what "type while it is still answering" means.
 *
 * The composer used to lock for the whole turn: textarea disabled, send
 * greyed, Enter dead. That trains a person to stop thinking while the agent
 * thinks, which is exactly backwards — the moment you most want to add "and
 * skip the ones already closed" is halfway through the tool calls.
 *
 * So the box never locks. Enter mid-turn appends to this queue instead of
 * sending, the queued lines render above the composer, and the moment the
 * turn LANDS they go out in order, as separate user turns, untouched.
 *
 * Pure on purpose: ordering, drop, edit-back, flush-on-complete and
 * hold-on-failure are the whole contract, and they are worth asserting
 * without a browser. `useSendQueue` is the thin React skin over this.
 *
 * What it deliberately does NOT do: steer the running turn. See
 * docs/agent-chat-surface.md §12 for why mid-turn injection is not reachable
 * from the current harness and what the smallest unlock would be.
 */

/** One line a person typed while the agent was still answering. */
export type QueuedMessage = {
  /** Stable client id — the row key, and what `drop`/`edit` name. */
  id: string;
  text: string;
  /** Epoch ms, for ordering stability across a sessionStorage round-trip. */
  at: number;
};

/**
 * How the last turn ENDED. The queue flushes on `completed` and on nothing
 * else: a turn the person stopped, or one that failed, must not silently
 * fire the three follow-ups they typed while it was going wrong.
 */
export type TurnOutcome = 'idle' | 'running' | 'completed' | 'stopped' | 'error';

export type QueueState = {
  items: QueuedMessage[];
  /**
   * Set when a turn ended without flushing and the queue survived it. The
   * composer says so — a person's typing is never dropped quietly, and never
   * sent without them noticing either.
   */
  held: boolean;
};

export type QueueAction
  = | { type: 'enqueue'; id: string; text: string; at: number }
    /** The ✕ on a queued row. */
    | { type: 'drop'; id: string }
    /** Clicking a queued row: it leaves the queue and goes back in the box. */
    | { type: 'edit'; id: string }
    /** The head just went out as its own turn. */
    | { type: 'shift' }
    /** The turn stopped or failed — keep everything, and say so. */
    | { type: 'hold' }
    /** Person acknowledged the hold (typed, sent, or dismissed it). */
    | { type: 'release' }
    /** Restore from sessionStorage on mount. */
    | { type: 'hydrate'; items: QueuedMessage[] }
    | { type: 'clear' };

export const emptyQueue: QueueState = { items: [], held: false };

/**
 * Fold one action into the queue.
 *
 * `enqueue` ignores blank text (Enter on an empty box mid-turn is a no-op,
 * not a blank row) and always appends — order is what the person typed.
 * @param state - The queue as it stands.
 * @param action - What just happened.
 */
export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'enqueue': {
      const text = action.text.trim();
      if (!text) {
        return state;
      }
      return {
        items: [...state.items, { id: action.id, text, at: action.at }],
        // Typing again is an acknowledgement — the notice clears.
        held: false,
      };
    }
    case 'drop':
    case 'edit':
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case 'shift':
      return { items: state.items.slice(1), held: false };
    case 'hold':
      // Nothing queued, nothing to warn about.
      return state.items.length === 0 ? { ...state, held: false } : { ...state, held: true };
    case 'release':
      return { ...state, held: false };
    case 'hydrate':
      return { items: action.items, held: false };
    case 'clear':
      return emptyQueue;
    default:
      return state;
  }
}

/**
 * The queued row a `drop`/`edit` names, so a caller can put its text back in
 * the box.
 * @param state - The queue as it stands.
 * @param id - The row's client id.
 */
export function findQueued(state: QueueState, id: string): QueuedMessage | null {
  return state.items.find(i => i.id === id) ?? null;
}

/**
 * The message that should go out RIGHT NOW, if any.
 *
 * Exactly one condition: nothing is streaming, the last turn completed
 * cleanly, and something is waiting. A stopped or errored turn returns null
 * and the queue is held instead — see `QueueState.held`.
 * @param state - The queue as it stands.
 * @param opts - Live turn status.
 * @param opts.streaming - True while a turn is in flight.
 * @param opts.outcome - How the last turn ended.
 */
export function nextInQueue(state: QueueState, opts: { streaming: boolean; outcome: TurnOutcome }): QueuedMessage | null {
  if (opts.streaming || opts.outcome !== 'completed' || state.items.length === 0) {
    return null;
  }
  return state.items[0] ?? null;
}

/**
 * sessionStorage key for one conversation's queue (a fresh thread has no id yet).
 * @param conversationId - The thread's id, or null before it has one.
 */
export function queueStorageKey(conversationId: number | null): string {
  return `vocion.chat.queue.${conversationId ?? 'new'}`;
}

/**
 * Defensive parse of a persisted queue — anything malformed reads as empty.
 * @param raw - Whatever sessionStorage held under the key.
 */
export function parseStoredQueue(raw: string | null): QueuedMessage[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((i): i is QueuedMessage =>
        typeof i === 'object' && i !== null
        && typeof (i as QueuedMessage).id === 'string'
        && typeof (i as QueuedMessage).text === 'string'
        && typeof (i as QueuedMessage).at === 'number')
      .map(i => ({ id: i.id, text: i.text, at: i.at }));
  } catch {
    return [];
  }
}
