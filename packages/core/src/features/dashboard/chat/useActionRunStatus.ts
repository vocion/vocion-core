'use client';

import type { ResultLink } from '@/libs/actions/resultLinks';
import { useEffect, useRef, useState } from 'react';
import { useLive } from '@/hooks/useLive';
import { liveTopic } from '@/libs/live/topics';
import { client } from '@/libs/Orpc';

/**
 * Where a proposed action stands, kept fresh (R4). The chat card that filed
 * a recommendation into the review queue used to freeze at "in your queue";
 * this reads `review.actionStatus` whenever the run changes, pushed on the
 * live stream (`card:<id>`), so the conversation learns whether the person
 * approved it, the action executed, or it failed — without leaving the page.
 * While the stream is down it polls with backoff (2s → 30s) until the run is
 * terminal, as it did before the stream existed.
 *
 * A card whose run lives in ANOTHER workspace (one the person's assistant
 * brought back) has no topic on this workspace's stream, so it polls — but
 * only while someone is looking: not while the tab is hidden, and not past
 * {@link FOREIGN_IDLE_MS} with nothing changing. Coming back to the tab reads
 * it again and resumes, and so does a card that had settled, so an Undo made
 * later in that workspace still reaches the card.
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
  /** A ruling's answer (`chosenOption`): the option, and whether the trust bar chose it. */
  choice?: { label: string; byTrustBar: boolean } | null;
  fetchedAt: number;
};

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'failed', 'rejected', 'undone', 'closed']);

const MIN_MS = 2_000;
const MAX_MS = 30_000;

/** How long a card from another workspace polls with nothing changing, before it waits for the person to come back to the tab. */
export const FOREIGN_IDLE_MS = 10 * 60_000;

/**
 * Whether to read the status again on the backoff.
 * @param s - Where the card stands.
 * @param s.status - The status last read, or null when the read failed.
 * @param s.live - The workspace stream pushes this run's changes.
 * @param s.foreign - The run lives in another workspace (no topic, polled).
 * @param s.hidden - The tab is hidden.
 * @param s.idleMs - How long the status has gone unchanged.
 */
export function keepPolling(s: { status: string | null; live: boolean; foreign: boolean; hidden: boolean; idleMs: number }): boolean {
  if (s.status !== null && (s.live || TERMINAL_STATUSES.has(s.status))) {
    return false;
  }
  return !s.foreign || (!s.hidden && s.idleMs < FOREIGN_IDLE_MS);
}

function tabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

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
 * @param workspaceId - The workspace the run lives in, when it is not this
 * one (a card the person's assistant brought back). Its status is read there;
 * this workspace's live stream carries no notice for it, so it is polled.
 */
export function useActionRunStatus(runId: number | undefined, nonce = 0, workspaceId?: string): ActionRunStatus | null {
  const [state, setState] = useState<ActionRunStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by a live notice: read now, wherever the card was decided.
  const [pushed, setPushed] = useState(0);

  // PUSHED (backlog 050): the card follows its run on the workspace live
  // stream for as long as it is on screen — decided on Review, by a trust
  // rule, from another tab, or undone after it ran — and reads its status the
  // moment it changes. Polling below is only the fallback while the stream
  // is down.
  const { live } = useLive(isPollableRunId(runId) && !workspaceId ? [liveTopic.card(runId)] : [], () => setPushed(n => n + 1));

  // A card from another workspace is read again when the person comes back
  // to the tab: polling paused while it was hidden or idle, and a settled run
  // may have been undone there since.
  const [returned, setReturned] = useState(0);
  useEffect(() => {
    if (!workspaceId || !isPollableRunId(runId) || typeof window === 'undefined') {
      return;
    }
    const back = () => {
      if (!tabHidden()) {
        setReturned(n => n + 1);
      }
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [workspaceId, runId]);

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
    // When the status last changed (or this read began), for the idle cap.
    let changedAt = Date.now();

    const tick = async () => {
      try {
        const res = await client.review.actionStatus({ id, ...(workspaceId ? { workspaceId } : {}) }) as { status: string; summary?: string | null; decidedBy: string | null; decidedAt: string | null; approvedByAgent?: boolean; undoable?: boolean; reason?: string | null; recordHref?: string | null; recordHrefLabel?: string | null; links?: ResultLink[]; choice?: { label: string; byTrustBar: boolean } | null };
        if (cancelled) {
          return;
        }
        setState((prev) => {
          if (prev && prev.status === res.status) {
            unchanged += 1;
          } else {
            unchanged = 0;
            delay = MIN_MS;
            changedAt = Date.now();
          }
          return { status: res.status, summary: res.summary ?? null, decidedBy: res.decidedBy ?? null, decidedAt: res.decidedAt ?? null, approvedByAgent: res.approvedByAgent, undoable: res.undoable, reason: res.reason ?? null, recordHref: res.recordHref ?? null, recordHrefLabel: res.recordHrefLabel ?? null, links: res.links ?? [], choice: res.choice ?? null, fetchedAt: Date.now() };
        });
        // Pushed, or settled: one read, and the stream (or nothing) says when
        // the next is due. A foreign card stops while nobody is looking.
        if (!keepPolling({ status: res.status, live, foreign: Boolean(workspaceId), hidden: tabHidden(), idleMs: Date.now() - changedAt })) {
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
        if (!keepPolling({ status: null, live, foreign: Boolean(workspaceId), hidden: tabHidden(), idleMs: Date.now() - changedAt })) {
          return;
        }
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
  }, [runId, nonce, pushed, live, workspaceId, returned]);

  return state;
}
