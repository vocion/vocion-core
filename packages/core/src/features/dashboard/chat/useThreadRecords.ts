'use client';

import type { TurnRecord } from '@/libs/factory/liveStatus';
import { useEffect, useState } from 'react';

/**
 * The records this thread is about (`GET /api/v1/conversations/:id/records`):
 * what its own actions filed, and what its latest turn read or wrote. Read
 * when the thread opens and again whenever a turn ends, so the microcards
 * under the latest turn survive a reload and follow the thread.
 * @param conversationId - The thread, once it has one.
 * @param turnKey - Changes when a turn ends (the message count, and whether one is streaming).
 */
export function useThreadRecords(conversationId: number | null | undefined, turnKey: string): TurnRecord[] {
  const [records, setRecords] = useState<{ for: number; list: TurnRecord[] } | null>(null);
  useEffect(() => {
    if (!conversationId) {
      return;
    }
    let alive = true;
    fetch(`/api/v1/conversations/${conversationId}/records`, { credentials: 'same-origin', cache: 'no-store' })
      .then(res => (res.ok ? res.json() as Promise<{ records: TurnRecord[] }> : null))
      .then((body) => {
        if (alive && body) {
          setRecords({ for: conversationId, list: body.records ?? [] });
        }
      })
      // A failed read leaves the live turn's own records; the next turn reads again.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [conversationId, turnKey]);
  return records && records.for === conversationId ? records.list : [];
}
