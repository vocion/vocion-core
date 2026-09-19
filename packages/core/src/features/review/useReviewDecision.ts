'use client';

import type { ContentEdit } from './contentKinds';
import type { ReviewCardRun } from './ReviewSurface';
import type { ReviewContentEdit } from '@/libs/actions/types';
import { useEffect, useState } from 'react';
import { isPollableRunId } from '@/features/dashboard/chat/useActionRunStatus';
import { withMinimumPending } from '@/features/dashboard/inbox/pending';
import { isRegeneratingFresh } from '@/libs/actions/regenerating';
import { client } from '@/libs/Orpc';

/**
 * The decide path of a review run, as a hook: the working copy of the
 * content edits, the ONE feedback note, snooze, regenerate (with the server's
 * in-flight stamp polled to completion), the execution-failure hold, and the
 * decision itself — everything `ReviewSurface` does that is not a `<div>`.
 *
 * ONE path, for every surface that decides a run. The review queue and the
 * lead page both mount `ReviewSurface`, which mounts this: deciding on either
 * is the same operation on the same run, through the same calls.
 *
 * `extraContentEdits` lets a surface merge edits it did not author — the
 * guided review's revisions, saved per run in `localStorage` — so a rewrite
 * asked for in the conversation rides an Enroll taken on the page.
 */

export type ReviewDecision = 'approve' | 'reject';
export type ReviewOutcome = ReviewDecision | 'snooze' | 'regenerate';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function useReviewDecision(run: ReviewCardRun, opts: {
  onDecided?: (outcome: ReviewOutcome) => void;
  onRegenerated?: () => void;
  /** Edits from another surface, merged under the page's own (the page's win per id). */
  extraContentEdits?: () => ReviewContentEdit[];
} = {}) {
  const { onDecided, onRegenerated } = opts;
  const [contentEdits, setContentEdits] = useState<Record<string, ContentEdit>>({});
  const [propertyEdits, setPropertyEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // The in-flight regeneration, as the SERVER knows it: seeded from the run
  // row (a reload mid-regeneration shows the same disabled surface) and kept
  // current by the status poll below. `since` is an ISO string throughout.
  const [regen, setRegen] = useState<{ since: string; note: string | null } | null>(null);
  // The last execution failure: seeded from a `failed` run and set live when
  // an approve's execution comes back failed. The surface stays decidable
  // with the error on it; Approve becomes Retry.
  const [execError, setExecError] = useState<string | null>(
    run.status === 'failed' ? (run.error ?? 'The action failed to execute.') : null,
  );

  // Reset the working copy when the surface moves to another run.
  useEffect(() => {
    setContentEdits({});
    setNote('');
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setExecError(run.status === 'failed' ? (run.error ?? 'The action failed to execute.') : null);
    const properties = (run.input.properties ?? {}) as Record<string, unknown>;
    setPropertyEdits(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, str(v)])));
  }, [run.id]);

  const runStamp = run.regeneratingSince == null
    ? null
    : typeof run.regeneratingSince === 'string' ? run.regeneratingSince : run.regeneratingSince.toISOString();
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setRegen(runStamp ? { since: runStamp, note: run.regenerateNote ?? null } : null);
  }, [run.id, runStamp]);

  // While a regeneration is in flight, poll the run every 5s (and on window
  // focus): the stamp clearing is the completion edge — the surface refetches
  // and re-enables with the new content, feedback cleared.
  useEffect(() => {
    if (!regen) {
      return;
    }
    let alive = true;
    const check = async () => {
      try {
        const s = await (isPollableRunId(run.id) ? client.review.actionStatus({ id: run.id }) : Promise.reject(new Error('not a run')));
        if (!alive) {
          return;
        }
        if (s.regeneratingSince == null) {
          setRegen(null);
          setNote('');
          onRegenerated?.();
        } else {
          setRegen({ since: s.regeneratingSince, note: s.regenerateNote ?? null });
        }
      } catch {
        /* transient — the next tick retries */
      }
    };
    const timer = setInterval(() => void check(), 5_000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [regen !== null, run.id]);

  // Fresh stamp = hold the surface; a stale one (a wedged pass) re-enables it
  // with a caution, matching the server guards expiring.
  const regenerating = regen !== null && isRegeneratingFresh(regen.since);
  const regenStale = regen !== null && !regenerating;
  const held = busy || regenerating;
  const hasProperties = run.input.properties !== undefined && (run.card.content?.length ?? 0) === 0;

  const buildDecision = () => {
    const own: ReviewContentEdit[] = Object.entries(contentEdits).map(([id, e]) => ({ id, ...e }));
    const ownIds = new Set(own.map(e => e.id));
    const extra = (opts.extraContentEdits?.() ?? []).filter(e => !ownIds.has(e.id));
    const edits = [...own, ...extra];
    const editedInput = hasProperties
      ? { ...run.input, properties: { ...(run.input.properties as Record<string, unknown>), ...propertyEdits } }
      : undefined;
    return { contentEdits: edits.length > 0 ? edits : undefined, editedInput };
  };

  const decide = async (decision: ReviewDecision) => {
    setBusy(true);
    try {
      const { contentEdits: ce, editedInput } = buildDecision();
      // Never less than ~400ms in flight: a decision that lands instantly
      // reads as nothing having happened.
      const outcome = await withMinimumPending(client.review.decideAction({
        id: run.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === 'approve' && ce ? { contentEdits: ce } : {}),
        ...(decision === 'approve' && editedInput ? { editedInput } : {}),
      }));
      // A failed execution is NOT a completed decision: the surface stays
      // with the error on it and Approve becomes Retry.
      if (decision === 'approve' && outcome.execution?.status === 'failed') {
        setExecError(outcome.execution.error ?? 'The action failed to execute.');
        return;
      }
      setExecError(null);
      onDecided?.(decision);
    } finally {
      setBusy(false);
    }
  };

  const snooze = async (untilOrDays: number | Date) => {
    setBusy(true);
    try {
      const until = untilOrDays instanceof Date ? untilOrDays : new Date(Date.now() + untilOrDays * 86_400_000);
      await withMinimumPending(client.review.snoozeAction({
        id: run.id,
        until: until.toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }));
      onDecided?.('snooze');
    } finally {
      setBusy(false);
    }
  };

  // Regenerate — re-run the work behind the run with the feedback as the
  // instruction. The surface HOLDS ITS PLACE: the server stamps the run, this
  // disables on that truth, and the poll re-enables in place when the new
  // content lands — same run id, zero duplicates.
  /**
   * @param instruction - What the pass should do differently. Defaults to the
   * shared feedback note, for a surface with no per-item control of its own.
   * @param contentId - Which item the instruction is about (`send-3`), so the
   * route files the copy it is about to replace against that send rather than
   * against the run at large. Absent on a surface with one body.
   */
  const regenerate = async (instruction?: string, contentId?: string) => {
    setBusy(true);
    try {
      const feedback = (instruction ?? note).trim();
      await withMinimumPending(client.review.regenerateAction({ id: run.id, feedback, ...(contentId ? { contentId } : {}) }));
      setRegen({ since: new Date().toISOString(), note: feedback });
      onDecided?.('regenerate');
    } finally {
      setBusy(false);
    }
  };

  const editContent = (id: string, patch: ContentEdit) =>
    setContentEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));
  const editProperty = (key: string, value: string) =>
    setPropertyEdits(e => ({ ...e, [key]: value }));

  return {
    note,
    setNote,
    busy,
    held,
    regenerating,
    regenStale,
    regen,
    execError,
    contentEdits,
    editContent,
    propertyEdits,
    editProperty,
    hasProperties,
    canRegenerate: Boolean(run.card.canRegenerate) && run.status !== 'failed',
    decide,
    snooze,
    regenerate,
  };
}
