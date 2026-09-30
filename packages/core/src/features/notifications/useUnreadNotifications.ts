'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { fetchUnreadCount, NOTIFICATIONS_CHANGED } from './notificationClient';

/** How often the bell re-reads its count while the tab is visible. */
const POLL_MS = 30_000;

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

/**
 * The bell's unread count.
 *
 * POLLED, for now: backlog 050's live stream (topic `notification:<userId>`)
 * was not on main when notifications shipped. The server announces every
 * change in one place (`services/notifications/live.ts`); when the stream
 * lands, this hook follows that topic and the interval goes. Meanwhile it
 * re-reads every 30s while the tab is visible, at once when it becomes
 * visible again, and at once when anything on the page marks a notification
 * read (`NOTIFICATIONS_CHANGED`). A failed read keeps the last count — a stale
 * badge is a smaller fault than a missing one.
 */
export function useUnreadNotifications(): { unread: number | null; refresh: () => void } {
  const [unread, setUnread] = useState<number | null>(null);
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true);
  const refresh = useCallback(() => {
    fetchUnreadCount().then(setUnread).catch(() => {});
  }, []);
  useEffect(() => {
    if (!visible) {
      return;
    }
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [visible, refresh]);
  return { unread, refresh };
}
