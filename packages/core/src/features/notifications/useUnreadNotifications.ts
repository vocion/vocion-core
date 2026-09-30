'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLive } from '@/hooks/useLive';
import { liveTopic } from '@/libs/live/topics';
import { fetchUnreadCount, NOTIFICATIONS_CHANGED } from './notificationClient';

/**
 * How often the bell re-reads its count while the live stream is NOT carrying
 * changes (connecting, refused, no EventSource). With the stream up it does
 * not poll at all.
 */
const FALLBACK_POLL_MS = 30_000;

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

/**
 * The bell's unread count, PUSHED (backlog 050). It follows the person's
 * `notification:<userId>` topic on the workspace live stream — a notification
 * row written or read rings it by trigger (migration 0156), from the app or
 * the worker — and re-reads the count on each notice. It also re-reads when
 * anything on this page marks a notification read (`NOTIFICATIONS_CHANGED`)
 * and when the tab becomes visible again. Only while the stream is down does
 * it fall back to a 30s poll (`useLive`'s rule: the follower keeps its old
 * cadence until the stream is live). A failed read keeps the last count — a
 * stale badge is a smaller fault than a missing one.
 */
export function useUnreadNotifications(): { unread: number | null; refresh: () => void } {
  const [unread, setUnread] = useState<number | null>(null);
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true);
  const refresh = useCallback(() => {
    fetchUnreadCount().then(setUnread).catch(() => {});
  }, []);
  const { live } = useLive(userId ? [liveTopic.notification(userId)] : [], refresh);
  useEffect(() => {
    if (!visible) {
      return;
    }
    refresh();
    const timer = live ? null : setInterval(refresh, FALLBACK_POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      if (timer) {
        clearInterval(timer);
      }
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [visible, live, refresh]);
  return { unread, refresh };
}
