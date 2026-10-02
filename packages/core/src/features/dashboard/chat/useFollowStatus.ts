'use client';

import type { TurnFollowup } from '@/libs/chat/turnFollowups';
import type { FollowStatus } from '@/services/preview/followStatus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '@/hooks/useLive';
import { topicsForRef } from '@/libs/live/topics';
import { client } from '@/libs/Orpc';

/** How often a chip still moving asks again while the live stream is down; it backs off while nothing changes. */
export const FOLLOW_POLL_MS = 4_000;
const FOLLOW_POLL_MAX_MS = 30_000;

const settled = (s: FollowStatus | undefined) => s !== undefined && (s.state === 'done' || s.state === 'failed');

/**
 * The live status of each thing a turn set moving, keyed `type:id`: read
 * once, then again whenever one of them changes — a run claimed, a record
 * moved, an ask answered — pushed on the workspace live stream from wherever
 * the change was written (backlog 050). A thing that has settled is no
 * longer followed. While the stream is down, the chips poll as they did
 * before it existed: every {@link FOLLOW_POLL_MS}, backing off while nothing
 * changes, and not at all once every one has settled.
 * @param follow - The turn's follow-ups.
 * @param pollMs - The first polling interval; {@link FOLLOW_POLL_MS} unless a test says otherwise.
 */
export function useFollowStatus(follow: readonly TurnFollowup[], pollMs = FOLLOW_POLL_MS): Record<string, FollowStatus> {
  const [statuses, setStatuses] = useState<Record<string, FollowStatus>>({});
  const refs = useMemo(() => follow.map(f => ({ type: f.ref.type as 'worker_run' | 'object' | 'ask' | 'artifact' | 'mission_run', id: f.ref.id })), [follow]);
  const signature = refs.map(r => `${r.type}:${r.id}`).join(',');

  // Pushed: every ref not yet settled. A burst of notices is one read.
  const [pushed, setPushed] = useState(0);
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topics = refs.filter(r => !settled(statuses[`${r.type}:${r.id}`])).flatMap(topicsForRef);
  const { live } = useLive(topics, () => {
    if (soon.current) {
      return;
    }
    soon.current = setTimeout(() => {
      soon.current = null;
      setPushed(n => n + 1);
    }, 250);
  });
  useEffect(() => () => {
    if (soon.current) {
      clearTimeout(soon.current);
    }
  }, []);

  useEffect(() => {
    if (refs.length === 0) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = pollMs;
    let last = '';
    const tick = async () => {
      try {
        const next = await client.preview.status({ refs }) as Record<string, FollowStatus>;
        if (cancelled) {
          return;
        }
        setStatuses(next);
        // Pushed: one read, and the stream says when the next is due.
        if (live || refs.every(r => settled(next[`${r.type}:${r.id}`]))) {
          return;
        }
        const now = JSON.stringify(next);
        delay = now === last ? Math.min(FOLLOW_POLL_MAX_MS, delay * 2) : pollMs;
        last = now;
      } catch {
        // A failed read is tried again with backoff, stream or no stream.
        delay = Math.min(FOLLOW_POLL_MAX_MS, delay * 2);
      }
      timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The refs are named by their signature; a new array with the same refs is the same read.
  }, [signature, pollMs, live, pushed]);

  return statuses;
}
