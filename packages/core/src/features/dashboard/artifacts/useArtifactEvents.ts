'use client';

/**
 * Keeps the pane in step with the server without owning the stream.
 *
 * Live `artifact` events reach the pane through `useChatSession`'s `onEvent`
 * seam (see `ConversationArtifactView`). This hook is the SETTLE feed: on
 * mount and whenever a turn ends (`isStreaming` true → false) the
 * conversation's artifacts are re-read, so an update lands even if the live
 * event was missed — a reload mid-turn, a resumed stream, a second tab.
 */

import type { Dispatch } from 'react';
import type { ArtifactAction, ArtifactEntry } from './artifactReducer';
import { useEffect, useRef } from 'react';
import { client } from '@/libs/Orpc';

export function useArtifactEvents(opts: {
  conversationId: number | null;
  isStreaming: boolean;
  dispatch: Dispatch<ArtifactAction>;
}) {
  const { conversationId, isStreaming, dispatch } = opts;
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
          dispatch({ type: 'set', artifacts: rows as ArtifactEntry[] });
        }
      })
      .catch((err) => {
        console.warn('artifacts: could not load them for this conversation', err);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, isStreaming, dispatch]);
}
