'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { relativeLabel } from '@/libs/timeAgo';

/**
 * Keep a server-rendered list page current while someone is looking at it.
 *
 * A manifest that says `live: {every: 15}` gets this in its title row. Every
 * `everyMs` it asks the router to re-read the page — the server component
 * runs again, rows and stats come back fresh, and nothing on the client is
 * lost — and it says when it last did ("live · 12s ago"). A hidden tab does
 * not poll: the interval clears on `visibilitychange`, and coming back
 * refreshes at once rather than waiting out the rest of an interval.
 *
 * Polling rather than a socket, the way the eval run page does it
 * (`RunAutoRefresh`): the payload is one page, the cadence a person can
 * follow is seconds not milliseconds, and the only push channel in the
 * product is the per-conversation agent stream — there is no org-wide
 * activity feed to subscribe to. The cost is one request per interval per
 * open tab, and the manifest bounds the interval.
 * @param props - Props.
 * @param props.everyMs - How often to re-read while visible.
 */
export function LiveRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // The tab's visibility as an external store: true on the server, the
  // document's word on the client, re-read on every `visibilitychange`.
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, () => true);
  // The last read, for working out when the next one is due after a return.
  const lastRead = useRef(updatedAt);

  const refresh = useCallback(() => {
    router.refresh();
    const t = Date.now();
    lastRead.current = t;
    setUpdatedAt(t);
    setNow(t);
  }, [router]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    // The first read comes when it would have been due — at once, if the tab
    // was hidden longer than the interval — and the interval runs from there.
    let poll: ReturnType<typeof setInterval> | null = null;
    const due = Math.max(0, everyMs - (Date.now() - lastRead.current));
    const first = setTimeout(() => {
      refresh();
      poll = setInterval(refresh, everyMs);
    }, due);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      if (poll) {
        clearInterval(poll);
      }
      clearInterval(tick);
    };
  }, [visible, everyMs, refresh]);

  return (
    <span
      role="status"
      aria-live="off"
      data-live={visible ? 'on' : 'paused'}
      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
      title={visible ? `Re-reads every ${Math.round(everyMs / 1000)}s while this tab is open` : 'Paused while this tab is hidden'}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${visible ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
      {visible ? `live · ${relativeLabel(new Date(updatedAt), now)}` : 'paused'}
    </span>
  );
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function readVisible(): boolean {
  return document.visibilityState !== 'hidden';
}
