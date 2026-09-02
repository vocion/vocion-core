'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/libs/Orpc';

export type LastViewedConversation = {
  agentSlug: string;
  conversationId: number | null;
  /** ISO string. Stamped locally by `persist`, or normalized from the server's value on hydration. */
  updatedAt: string;
};

const STORAGE_KEY = 'vocion_chat_last_viewed';

function readLocal(): LastViewedConversation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LastViewedConversation;
    return typeof parsed.agentSlug === 'string' ? parsed : null;
  } catch (error) {
    console.error('useLastViewedConversation: failed to parse localStorage value', error);
    return null;
  }
}

function writeLocal(next: LastViewedConversation) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    // storage unavailable (private mode, quota) — the server copy still holds
    console.error('useLastViewedConversation: failed to write localStorage', error);
  }
}

/**
 * The single source of truth ChatShell (full page) and ChatBubble both read
 * on mount and write to on every view change, so opening either surface
 * always resumes the conversation that was last viewed on the other.
 * Server state wins when reachable; localStorage is the offline fallback.
 */
export function useLastViewedConversation() {
  const [state, setState] = useState<LastViewedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    client.chatWidget.getState()
      .then((serverState) => {
        if (!mountedRef.current) {
          return;
        }
        if (serverState) {
          // `updatedAt` can arrive as a `Date` object or a string depending
          // on oRPC's serialization — normalize to an ISO string so both
          // localStorage and hook state stay consistently JSON-serializable
          // (same defensive pattern as ChatBubbleHistoryPanel's ConversationSummary).
          const normalized: LastViewedConversation = {
            ...serverState,
            updatedAt: new Date(serverState.updatedAt).toISOString(),
          };
          writeLocal(normalized);
          setState(normalized);
        } else {
          setState(readLocal());
        }
      })
      .catch((error) => {
        // Offline, private browsing, or a transient blip — this is the
        // hook's designed steady-state fallback, not an anomaly, so warn
        // rather than error.
        console.warn('useLastViewedConversation: server getState failed, falling back to localStorage', error);
        if (mountedRef.current) {
          setState(readLocal());
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false);
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const persist = useCallback((next: Pick<LastViewedConversation, 'agentSlug' | 'conversationId'>) => {
    const stamped: LastViewedConversation = { ...next, updatedAt: new Date().toISOString() };
    setState(stamped);
    writeLocal(stamped);
    client.chatWidget.setState(next).catch((error) => {
      // persistence is best-effort — localStorage already has the fallback,
      // so a rejected sync (offline, transient blip) is expected, not a bug.
      console.warn('useLastViewedConversation: server setState failed', error);
    });
  }, []);

  return { state, loading, persist };
}
