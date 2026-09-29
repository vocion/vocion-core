'use client';

import type { ResultLink } from '@/libs/actions/resultLinks';
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
  /** The ladder released it without a person — "done for you". */
  approvedByAgent?: boolean;
  /** A done run the card can put back. */
  undoable?: boolean;
  /** Why it ran on its own, when it did. */
  reason?: string | null;
  /** What a done run did, from its result: "changed request #124: outcome, mainRisk" (`libs/actions/doneSummary.ts`). */
  summary?: string | null;
  /** The page of the record the run made (a filed request), once it has run. */
  recordHref?: string | null;
  /** The words on that link: "Open feature". */
  recordHrefLabel?: string | null;
  /** Everything a done run made, as links (`libs/actions/resultLinks.ts`). */
  links?: ResultLink[];
  fetchedAt: number;
};

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'failed', 'rejected', 'undone', 'closed']);

const MIN_MS = 2_000;
const MAX_MS = 30_000;

/**
 * Whether this id is worth polling. A run id is a database key: anything that
 * is not a positive integer is not a run, and asking about it just 400s.
 * @param runId - The candidate id.
 */
export function isPollableRunId(runId: number | undefined): runId is number {
  return typeof runId === 'number' && Number.isInteger(runId) && runId > 0;
}

/**
 * A 4xx from the RPC layer — the request itself was refused, so do not retry
 * it. A dropped connection carries no status and is worth another go.
 * @param err - Whatever the call threw.
 */
export function isRequestRejected(err: unknown): boolean {
  const status = (err as { status?: unknown; code?: unknown })?.status ?? (err as { code?: unknown })?.code;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * @param runId - The run to follow.
 * @param nonce - Change it to read the status now rather than on the backoff —
 * after a decision, so the card does not sit on a stale "pending".
 */
export function useActionRunStatus(runId: number | undefined, nonce = 0): ActionRunStatus | null {
  const [state, setState] = useState<ActionRunStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A run id that is not a positive integer is not a run: polling it just
    // 400s, and the loop retried that forever — three red rows in the console
    // on every inbox page (2026-09-15). Nothing to poll, nothing to say.
    if (!isPollableRunId(runId)) {
      return;
    }
    const id = runId;
    let cancelled = false;
    let delay = MIN_MS;
    let unchanged = 0;

    const tick = async () => {
      try {
        const res = await client.review.actionStatus({ id }) as { status: string; summary?: string | null; decidedBy: string | null; decidedAt: string | null; approvedByAgent?: boolean; undoable?: boolean; reason?: string | null; recordHref?: string | null; recordHrefLabel?: string | null; links?: ResultLink[] };
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
          return { status: res.status, summary: res.summary ?? null, decidedBy: res.decidedBy ?? null, decidedAt: res.decidedAt ?? null, approvedByAgent: res.approvedByAgent, undoable: res.undoable, reason: res.reason ?? null, recordHref: res.recordHref ?? null, recordHrefLabel: res.recordHrefLabel ?? null, links: res.links ?? [], fetchedAt: Date.now() };
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
  }, [runId, nonce]);

  return state;
}
