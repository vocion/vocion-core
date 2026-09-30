'use client';

import type { LiveState } from '@/libs/live/client';
import type { LiveNotice } from '@/libs/live/topics';
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { liveClient } from '@/libs/live/client';

/**
 * Follow topics on the workspace live stream (backlog 050).
 *
 * `onNotice` runs when something followed changes — re-read it through its
 * own read. A notice of kind `resync` means the stream could not replay a
 * gap: read everything followed again. Every follower on the page shares one
 * connection (`libs/live/client.ts`).
 *
 * `live` says whether the stream is carrying changes. While it is false —
 * connecting, refused, unreachable, no `EventSource` — keep the poll you had
 * before the stream existed; when it turns true, stop polling. That is the
 * whole fallback, and it is the follower's, because only the follower knows
 * its cadence.
 * @param topics - What to follow (`libs/live/topics.ts`); empty follows nothing.
 * @param onNotice - What to do on a change.
 * @returns Whether the stream is up, and its state.
 */
export function useLive(topics: readonly string[], onNotice: (notice: LiveNotice) => void): { live: boolean; state: LiveState } {
  const handler = useRef(onNotice);
  useLayoutEffect(() => {
    handler.current = onNotice;
  });
  const key = [...new Set(topics.filter(Boolean))].sort().join(',');
  const supported = typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';

  useEffect(() => {
    if (!key || !supported) {
      return;
    }
    return liveClient().add({ topics: new Set(key.split(',')), onNotice: n => handler.current(n) });
  }, [key, supported]);

  const subscribe = useCallback((onChange: () => void) => (key && supported ? liveClient().watch(onChange) : () => {}), [key, supported]);
  const state = useSyncExternalStore<LiveState>(
    subscribe,
    () => (!key ? 'idle' : !supported ? 'down' : liveClient().getState()),
    () => 'idle',
  );

  return { live: key !== '' && (state === 'open' || state === 'paused'), state };
}
