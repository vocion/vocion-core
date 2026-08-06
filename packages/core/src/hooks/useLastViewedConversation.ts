'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/libs/Orpc';

export type LastViewedConversation = {
  agentSlug: string;
  conversationId: number | null;
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
          writeLocal(serverState);
          setState(serverState);
        } else {
          setState(readLocal());
        }
      })
      .catch((error) => {
        console.error('useLastViewedConversation: server getState failed, falling back to localStorage', error);
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

  const persist = useCallback((next: LastViewedConversation) => {
    setState(next);
    writeLocal(next);
    client.chatWidget.setState(next).catch((error) => {
      // persistence is best-effort — localStorage already has the fallback
      console.error('useLastViewedConversation: server setState failed', error);
    });
  }, []);

  return { state, loading, persist };
}
