'use client';

import type { QueuedMessage, TurnOutcome } from './queueReducer';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  emptyQueue,
  findQueued,
  nextInQueue,
  parseStoredQueue,
  queueReducer,
  queueStorageKey,
} from './queueReducer';

export type UseSendQueueOptions = {
  /** Thread the queue belongs to — a fresh one keys off `new` until the id lands. */
  conversationId: number | null;
  /** True while a turn is in flight. */
  streaming: boolean;
  /** How the last turn ended — only `completed` releases the queue. */
  outcome: TurnOutcome;
  /** Send one queued line as its own user turn. */
  send: (text: string) => void | Promise<void>;
};

/** Monotonic-enough ids without pulling a uuid dependency into the client bundle. */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `q${Date.now().toString(36)}-${seq}`;
}

/**
 * The composer's send queue, wired to the live turn.
 *
 * Owns three things the pure reducer cannot: the ids, the sessionStorage
 * round-trip (so a rail resize, a route change inside the workspace, or a
 * collapse/expand of the dock never loses somebody's typing), and the effect
 * that drains the queue the instant a turn lands.
 *
 * The drain is ONE message per completed turn, by design: each queued line
 * becomes its own user turn, in order, exactly as if the person had waited
 * and pressed Enter. The `sendingRef` latch stops the same id going out twice
 * if React re-runs the effect before `streaming` flips.
 * @param options - See `UseSendQueueOptions`.
 * @param options.conversationId - Thread the queue belongs to.
 * @param options.streaming - True while a turn is in flight.
 * @param options.outcome - How the last turn ended.
 * @param options.send - Sends one queued line as its own user turn.
 */
export function useSendQueue({ conversationId, streaming, outcome, send }: UseSendQueueOptions) {
  const [state, dispatch] = useReducer(queueReducer, emptyQueue);
  const sendRef = useRef(send);
  const sendingRef = useRef<string | null>(null);
  // `edit` reads the live queue without re-creating its own identity on every
  // enqueue (the composer would otherwise re-render on every keystroke).
  const stateRef = useRef(state);
  // Both mirrors are written in an effect rather than during render, and this
  // effect is declared FIRST so React has run it before the drain effect below
  // reads either one in the same commit.
  useEffect(() => {
    sendRef.current = send;
    stateRef.current = state;
  });

  // Restore whatever this conversation had queued (same tab only — a queue is
  // not worth a server round-trip, and a new tab is a new train of thought).
  const storageKey = queueStorageKey(conversationId);
  const keyRef = useRef<string | null>(null);
  /** Set for the one commit in which the queue has not yet caught up with a thread switch. */
  const swallowOnePersistRef = useRef(false);
  useEffect(() => {
    const previous = keyRef.current;
    keyRef.current = storageKey;
    if (previous === storageKey) {
      return;
    }
    // A brand-new thread gets its id AFTER the first turn starts, so `new` →
    // `<id>` is the same conversation renaming itself. Carry the queue across
    // — the persist effect rewrites it under the new key — instead of
    // hydrating an empty one over somebody's typing.
    if (previous === queueStorageKey(null) && stateRef.current.items.length > 0) {
      try {
        window.sessionStorage.removeItem(previous);
      } catch {
        /* storage disabled */
      }
      return;
    }
    // Any other change is a different thread: adopt ITS queue, empty or not.
    // The persist effect below runs in this same commit, while `state` is
    // still the OLD thread's — so it is told to sit this pass out rather than
    // stamp the old queue onto the new thread's key.
    swallowOnePersistRef.current = true;
    try {
      dispatch({ type: 'hydrate', items: parseStoredQueue(window.sessionStorage.getItem(storageKey)) });
    } catch {
      dispatch({ type: 'hydrate', items: [] });
    }
  }, [storageKey]);

  useEffect(() => {
    if (swallowOnePersistRef.current) {
      swallowOnePersistRef.current = false;
      return;
    }
    try {
      if (state.items.length === 0) {
        window.sessionStorage.removeItem(storageKey);
      } else {
        window.sessionStorage.setItem(storageKey, JSON.stringify(state.items));
      }
    } catch {
      /* storage disabled — in-memory is still correct for this session */
    }
  }, [state.items, storageKey]);

  // The turn stopped or failed with things still queued: keep them, and say so.
  useEffect(() => {
    if (!streaming && (outcome === 'stopped' || outcome === 'error')) {
      dispatch({ type: 'hold' });
    }
  }, [streaming, outcome]);

  // The turn landed cleanly: send the head, then wait for THAT turn to land
  // before the next one goes.
  useEffect(() => {
    const next = nextInQueue(state, { streaming, outcome });
    if (!next || sendingRef.current === next.id) {
      return;
    }
    sendingRef.current = next.id;
    dispatch({ type: 'shift' });
    void sendRef.current(next.text);
  }, [state, streaming, outcome]);

  const enqueue = useCallback((text: string) => {
    dispatch({ type: 'enqueue', id: nextId(), text, at: Date.now() });
  }, []);

  const drop = useCallback((id: string) => {
    dispatch({ type: 'drop', id });
  }, []);

  /** Pull a queued line back into the composer — returns its text for the caller to set. */
  const edit = useCallback((id: string): string | null => {
    const found = findQueued(stateRef.current, id);
    if (!found) {
      return null;
    }
    dispatch({ type: 'edit', id });
    return found.text;
  }, []);

  const release = useCallback(() => {
    dispatch({ type: 'release' });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  return {
    /** Queued lines, oldest first. */
    items: state.items as QueuedMessage[],
    /** True when a stopped/failed turn left the queue unsent. */
    held: state.held,
    enqueue,
    drop,
    edit,
    release,
    clear,
  };
}

export type SendQueue = ReturnType<typeof useSendQueue>;
