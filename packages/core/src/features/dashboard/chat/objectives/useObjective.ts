'use client';

import type { ObjectiveView } from '@/libs/objectives/objective';
import { useCallback, useEffect, useState } from 'react';
import { SETUP_CHANGED_EVENT } from '@/features/dashboard/setupChanged';
import { client } from '@/libs/Orpc';

/**
 * The objective a conversation is in the middle of, read from the server —
 * never held only in the browser — so a reload, a trip through the drawer,
 * a tab come back from the background and another device all draw the same
 * line. Read again whenever the thread changes, a turn lands, a setup step
 * is done anywhere on the page, and the tab is shown again.
 * @param conversationId - The conversation, or null for a new one.
 * @param turnIdle - No turn is running (a turn that read the setup may have started one).
 */
export function useObjective(conversationId: number | null, turnIdle: boolean) {
  const [view, setView] = useState<ObjectiveView | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (conversationId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- a thread with no id is in the middle of nothing
      setView(null);
      return;
    }
    if (!turnIdle) {
      return;
    }
    let cancelled = false;
    // Through a resolved promise, so a client without the route (an old
    // server mid-deploy, a test double) draws no line rather than crashing.
    Promise.resolve()
      .then(() => client.objectives.current({ conversationId }))
      .then((next) => {
        if (!cancelled) {
          setView(next ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, turnIdle, tick]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    window.addEventListener(SETUP_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(SETUP_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const setState = useCallback(async (state: 'stopped' | 'running') => {
    if (conversationId === null) {
      return;
    }
    // Said at once; the server's answer settles it.
    setView(v => (v && v.state !== 'done' ? { ...v, state } : v));
    const next = await (state === 'stopped' ? client.objectives.stop({ conversationId }) : client.objectives.resume({ conversationId })).catch(() => null);
    if (next) {
      setView(next);
    } else {
      refresh();
    }
  }, [conversationId, refresh]);

  return {
    view,
    stop: () => void setState('stopped'),
    resume: () => void setState('running'),
    refresh,
  };
}
