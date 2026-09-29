/**
 * THE SOURCES OF AN ANSWER STILL BEING WRITTEN (Chris, 2026-09-29: "clicking
 * sources (6) showed zero (0) sources in the pane"). A turn's sources are
 * saved with its answer when the turn ends; the chip counts them as they
 * stream. Pressed mid-turn, the pane asked the server for sources nobody had
 * saved yet. The rail publishes the streaming answer's sources here, and the
 * pane reads them for that conversation until the answer is stored.
 */

import type { TurnSource } from './sourcesRef';
import { useSyncExternalStore } from 'react';

const live = new Map<number, readonly TurnSource[]>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/**
 * Publish (or, with null, clear) the streaming answer's sources for a conversation.
 * @param conversationId - The conversation.
 * @param sources - The sources so far, or null when the answer is stored.
 */
export function setLiveSources(conversationId: number, sources: readonly TurnSource[] | null): void {
  if (sources && sources.length > 0) {
    live.set(conversationId, sources);
  } else if (!live.delete(conversationId)) {
    return;
  }
  emit();
}

/**
 * The streaming answer's sources for a conversation, or null.
 * @param conversationId - The conversation.
 */
export function readLiveSources(conversationId: number): readonly TurnSource[] | null {
  return live.get(conversationId) ?? null;
}

/**
 * Subscribe a component to one conversation's live sources.
 * @param conversationId - The conversation, or null for none.
 */
export function useLiveSources(conversationId: number | null): readonly TurnSource[] | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (conversationId === null ? null : readLiveSources(conversationId)),
    () => null,
  );
}
