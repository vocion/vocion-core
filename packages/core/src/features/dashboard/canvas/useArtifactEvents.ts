'use client';

/**
 * Bridges the chat stream to the canvas without owning the stream.
 *
 * Two feeds, either sufficient:
 *   1. Live — `useChatSession` re-broadcasts every SSE event on `window` as
 *      `vocion:agent-event` (one line at its `handleEvent` entry, the R2
 *      seam). An `artifact` event is upserted the moment the tool runs.
 *   2. Settle — when a turn ends (`isStreaming` true → false) the artifacts
 *      for the conversation are re-read from the server, so a tile lands
 *      even if the live event was missed (reload mid-turn, resume, a second tab).
 */

import type { Dispatch } from 'react';
import type { CanvasAction } from './canvasReducer';
import type { ArtifactPayload } from '@/services/agents/types';
import { useEffect, useRef } from 'react';
import { client } from '@/libs/Orpc';

export const AGENT_EVENT_DOM_EVENT = 'vocion:agent-event';

export function useArtifactEvents(opts: {
  conversationId: number | null;
  isStreaming: boolean;
  dispatch: Dispatch<CanvasAction>;
}) {
  const { conversationId, isStreaming, dispatch } = opts;

  // Live feed.
  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<{ type?: string; artifact?: ArtifactPayload }>).detail;
      if (detail?.type === 'artifact' && detail.artifact) {
        if (conversationId === null || detail.artifact.conversationId === conversationId) {
          dispatch({ type: 'upsert', artifact: detail.artifact });
        }
      }
    }
    window.addEventListener(AGENT_EVENT_DOM_EVENT, onEvent);
    return () => window.removeEventListener(AGENT_EVENT_DOM_EVENT, onEvent);
  }, [conversationId, dispatch]);

  // Settle feed: initial load + after every turn.
  const wasStreaming = useRef(false);
  useEffect(() => {
    const ended = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;
    if (conversationId === null) {
      return;
    }
    if (!ended && wasStreaming.current) {
      return;
    }
    let cancelled = false;
    client.artifacts.listForConversation({ conversationId })
      .then((rows) => {
        if (!cancelled) {
          dispatch({ type: 'set', artifacts: rows as ArtifactPayload[] });
        }
      })
      .catch((err) => {
        console.warn('canvas: could not load artifacts', err);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, isStreaming, dispatch]);
}
