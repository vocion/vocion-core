'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/libs/Orpc';

export type LastViewedConversation = {
  agentSlug: string;
  conversationId: number | null;
  /** ISO string. Stamped locally by `persist`, or normalized from the server's value on hydration. */
  updatedAt: string;
  /** The rail's saved width in px (0094); null when never set. */
  railWidth?: number | null;
  /** Whether the rail was left open (0094); null when never set. */
  railOpen?: boolean | null;
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
 * The RECENT pointer ChatShell (full page) and the rail both read on mount
 * and write to on every view change. Since 2026-09-15 (agent-chat-surface.md
 * §9) it chooses the agent a surface opens with and seeds the history — it no
 * longer chooses the thread: a surface opens a new conversation unless this
 * browser session was already in one or the URL names one. It also carries
 * the rail's saved geometry (`railWidth`, `railOpen`).
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
          // (defensive: a row missing fields is skipped, never thrown on).
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

  /** Remember the rail's width / open state for this user (0094). Best-effort. */
  const persistRail = useCallback((next: { railWidth?: number | null; railOpen?: boolean | null }) => {
    setState(prev => (prev ? { ...prev, ...next } : prev));
    client.chatWidget.setRail(next).catch((error) => {
      console.warn('useLastViewedConversation: server setRail failed', error);
    });
  }, []);

  return { state, loading, persist, persistRail };
}
