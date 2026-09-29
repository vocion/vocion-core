'use client';

import type { TurnFollowup } from '@/libs/chat/turnFollowups';
import type { FollowStatus } from '@/services/preview/followStatus';
import { useEffect, useMemo, useState } from 'react';
import { client } from '@/libs/Orpc';

/** How often a chip still moving asks again; it backs off while nothing changes. */
export const FOLLOW_POLL_MS = 4_000;
const FOLLOW_POLL_MAX_MS = 30_000;

const settled = (s: FollowStatus | undefined) => s !== undefined && (s.state === 'done' || s.state === 'failed');

/**
 * The live status of each thing a turn set moving, keyed `type:id`, read now
 * and again while any of them is still queued, running or waiting — and not
 * at all once every one has settled.
 * @param follow - The turn's follow-ups.
 * @param pollMs - The first interval; {@link FOLLOW_POLL_MS} unless a test says otherwise.
 */
export function useFollowStatus(follow: readonly TurnFollowup[], pollMs = FOLLOW_POLL_MS): Record<string, FollowStatus> {
  const [statuses, setStatuses] = useState<Record<string, FollowStatus>>({});
  const refs = useMemo(() => follow.map(f => ({ type: f.ref.type as 'worker_run' | 'object' | 'ask' | 'artifact' | 'mission_run', id: f.ref.id })), [follow]);
  const signature = refs.map(r => `${r.type}:${r.id}`).join(',');

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
        const now = JSON.stringify(next);
        delay = now === last ? Math.min(FOLLOW_POLL_MAX_MS, delay * 2) : pollMs;
        last = now;
        if (refs.every(r => settled(next[`${r.type}:${r.id}`]))) {
          return;
        }
      } catch {
        delay = Math.min(FOLLOW_POLL_MAX_MS, delay * 2);
      }
      timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The refs are named by their signature; a new array with the same refs is the same poll.
  }, [signature, pollMs]);

  return statuses;
}
