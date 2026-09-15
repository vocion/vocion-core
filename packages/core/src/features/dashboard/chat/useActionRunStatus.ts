'use client';

import { useEffect, useRef, useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * Where a proposed action stands, kept fresh (R4). The chat card that filed
 * a recommendation into the review queue used to freeze at "in your queue";
 * this polls `review.actionStatus` with backoff (2s → 30s) until the run is
 * terminal, so the conversation learns whether the person approved it, the
 * action executed, or it failed — without leaving the page.
 *
 * `action_run.status` values seen in the services: pending, executing, done,
 * failed, rejected, snoozed. Anything else renders as-is.
 */

export type ActionRunStatus = {
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  fetchedAt: number;
};

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'failed', 'rejected']);

const MIN_MS = 2_000;
const MAX_MS = 30_000;

/** A 4xx from the RPC layer — the request itself was refused, so do not retry it. */
function isRequestRejected(err: unknown): boolean {
  const status = (err as { status?: unknown; code?: unknown })?.status ?? (err as { code?: unknown })?.code;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function useActionRunStatus(runId: number | undefined): ActionRunStatus | null {
  const [state, setState] = useState<ActionRunStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A run id that is not a positive integer is not a run: polling it just
    // 400s, and the loop retried that forever — three red rows in the console
    // on every inbox page (2026-09-15). Nothing to poll, nothing to say.
    if (!Number.isInteger(runId) || (runId as number) <= 0) {
      return;
    }
    let cancelled = false;
    let delay = MIN_MS;
    let unchanged = 0;

    const tick = async () => {
      try {
        const res = await client.review.actionStatus({ id: runId }) as { status: string; decidedBy: string | null; decidedAt: string | null };
        if (cancelled) {
          return;
        }
        setState((prev) => {
          if (prev && prev.status === res.status) {
            unchanged += 1;
          } else {
            unchanged = 0;
            delay = MIN_MS;
          }
          return { status: res.status, decidedBy: res.decidedBy ?? null, decidedAt: res.decidedAt ?? null, fetchedAt: Date.now() };
        });
        if (TERMINAL_STATUSES.has(res.status)) {
          return;
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        // A rejected REQUEST will be rejected the same way every time. Retry
        // transport failures; give up on anything the server refused.
        if (isRequestRejected(err)) {
          return;
        }
        unchanged += 1;
      }
      // Back off while nothing changes; snap back to 2s the moment it does.
      delay = Math.min(MAX_MS, MIN_MS * 2 ** Math.min(unchanged, 4));
      timer.current = setTimeout(() => void tick(), delay);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [runId]);

  return state;
}

/**
 * Human step labels for the card's status line.
 * @param s
 */
export function describeActionStatus(s: string): { label: string; tone: 'muted' | 'amber' | 'green' | 'red' } {
  switch (s) {
    case 'pending':
      return { label: 'In review', tone: 'amber' };
    case 'executing':
      return { label: 'Approved · running', tone: 'amber' };
    case 'done':
      return { label: 'Done', tone: 'green' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'rejected':
      return { label: 'Rejected', tone: 'red' };
    case 'snoozed':
      return { label: 'Snoozed', tone: 'muted' };
    default:
      return { label: s, tone: 'muted' };
  }
}
