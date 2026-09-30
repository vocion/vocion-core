'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { onPageReread, requestPageReread } from '@/features/dashboard/versions/pageReread';
import { useLive } from '@/hooks/useLive';
import { relativeLabel } from '@/libs/timeAgo';

/** How a live page re-reads itself: the fallback interval, what it follows, whether it polls when the stream is down. */
export type LiveRefreshOptions = { everyMs: number; follow?: readonly string[]; poll?: boolean };

/** What a live page knows about its own re-reading. */
export type LiveRefreshState = {
  /** The tab is visible; false = paused. */
  visible: boolean;
  /** When the page last re-read, ms. */
  updatedAt: number;
  /** The clock, ticking each second while visible, for "3s ago". */
  now: number;
  /** Re-read now. */
  refresh: () => void;
  /** Changes arrive on the live stream. */
  pushed: boolean;
  /** Re-reading on the interval (the stream is down, or the page follows nothing). */
  polling: boolean;
};

/**
 * The re-read {@link LiveRefresh} draws, as a hook, so another control can
 * carry it — the record's version chip (`versions/VersionChip`). Pushed on
 * the live stream when the page follows topics, polled on `everyMs` while
 * the stream is down. `null` re-reads nothing and returns null.
 * @param opts - How to re-read, or null for a page that is not live.
 */
export function useLiveRefresh(opts: LiveRefreshOptions | null): LiveRefreshState | null {
  const everyMs = opts?.everyMs ?? 0;
  const follow = opts?.follow;
  const poll = opts?.poll ?? true;
  const on = opts !== null;
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // The tab's visibility as an external store: true on the server, the
  // document's word on the client, re-read on every `visibilitychange`.
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, () => true);
  // The last read, for working out when the next one is due after a return.
  const lastRead = useRef(updatedAt);

  // Every re-read of the page — this one's, or the route's own VersionWatch's
  // — moves the label, whoever ran it (`pageReread.ts`).
  useEffect(() => onPageReread((t) => {
    lastRead.current = t;
    setUpdatedAt(t);
    setNow(t);
  }), []);
  // The page's ONE re-read: asked here, gathered with every other follower's
  // ask into one re-read per burst, run in the page owner's transition. In
  // place — the server component renders again and the client keeps its
  // state, its scroll and its open pane.
  // A tap, a return to the tab and the fallback poll read at once; a pushed
  // notice is gathered with the rest of its burst.
  const refresh = useCallback(() => requestPageReread(() => router.refresh(), { now: true }), [router]);
  const pushedRefresh = useCallback(() => requestPageReread(() => router.refresh()), [router]);

  // Pushed: a change to anything the page is made of re-reads it.
  const { live } = useLive(on ? follow ?? [] : [], pushedRefresh);
  const pushed = follow !== undefined && follow.length > 0 && live;
  const polling = on && !pushed && (follow === undefined || follow.length === 0 || poll);

  // The clock the label counts with, while anyone can see it.
  useEffect(() => {
    if (!visible || !on) {
      return;
    }
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [visible, on]);

  useEffect(() => {
    if (!visible || !polling) {
      return;
    }
    // The first read comes when it would have been due — at once, if the tab
    // was hidden longer than the interval — and the interval runs from there.
    let timer: ReturnType<typeof setInterval> | null = null;
    const due = Math.max(0, everyMs - (Date.now() - lastRead.current));
    const first = setTimeout(() => {
      refresh();
      timer = setInterval(refresh, everyMs);
    }, due);
    return () => {
      clearTimeout(first);
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [visible, everyMs, refresh, polling]);

  return on ? { visible, updatedAt, now, refresh, pushed, polling } : null;
}

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
 * FOLLOWED, when it says what it is made of (backlog 050). A page given
 * `follow` topics — a manifest's `live: {follow: [...]}`, the feature
 * page's records and runs — re-reads when one of them changes, pushed on the
 * workspace live stream, and does not poll at all while the stream is up.
 * Bursts are gathered: at most one re-read every 1.5s. The interval is then
 * only the fallback, used while the stream is down (and, with `poll` false,
 * not even then).
 * @param props - Props.
 * @param props.everyMs - How often to re-read while visible (the fallback, when following).
 * @param props.follow - Live-stream topics the page is made of.
 * @param props.poll - Whether to poll when the stream is down (default true).
 */
export function LiveRefresh({ everyMs, follow, poll = true }: { everyMs: number; follow?: readonly string[]; poll?: boolean }) {
  const { visible, updatedAt, now, refresh, pushed, polling } = useLiveRefresh({ everyMs, follow, poll })!;

  // What it says, in the two places it has room to say it. On a phone the
  // elapsed seconds are the least useful thing on the row — they change every
  // second, they are never acted on, and they push the state itself off the
  // edge. The DOT carries the state there: green live, amber paused. The
  // words come back from `sm:` up, where there is room for them.
  const seconds = Math.round(everyMs / 1000);
  const explain = !visible
    ? 'Paused while this tab is hidden. Tap to read now.'
    : pushed
      ? 'Live — updates the moment something on this page changes. Tap to read now.'
      : polling
        ? `Live — re-reads every ${seconds}s. Tap to read now.`
        : 'Up to date as of the last read. Tap to read now.';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={refresh}
          aria-label={explain}
          data-live={visible ? 'on' : 'paused'}
          data-pushed={pushed ? 'yes' : 'no'}
          data-testid="live-refresh"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${visible ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          {/* A word at every width: a bare dot in a corner says nothing (phone, 2026-09-24). */}
          <span className="sm:hidden">{visible ? 'live' : 'paused'}</span>
          <span className="hidden sm:inline">
            {visible ? `live · ${relativeLabel(new Date(updatedAt), now)}` : 'paused'}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{explain}</TooltipContent>
    </Tooltip>
  );
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function readVisible(): boolean {
  return document.visibilityState !== 'hidden';
}
