'use client';

import { useEffect, useState } from 'react';

/**
 * Seconds since this component first rendered, ticking while `active`.
 *
 * Shared rather than duplicated because two surfaces show the same number —
 * the work timeline's header and the live indicator at the end of a streaming
 * message — and two independent timers would drift apart within a minute.
 * @param active - Whether to keep ticking. Stops on false, keeping the last value.
 */
export function useElapsed(active: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!active) {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.floor((now - start) / 1000);
}

/**
 * Elapsed seconds as `22s` / `5m 15s`, the way the reference agent UIs read.
 * @param seconds - Whole seconds.
 */
export function formatElapsed(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
