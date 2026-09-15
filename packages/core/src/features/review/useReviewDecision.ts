'use client';

import type { ContentEdit } from './contentKinds';
import type { ReviewCardRun } from './ReviewActionCard';
import type { ReviewContentEdit } from '@/libs/actions/types';
import { useEffect, useState } from 'react';
import { isRegeneratingFresh } from '@/libs/actions/regenerating';
import { client } from '@/libs/Orpc';

/**
 * The decide path of a review run, as a hook: the working copy of the
 * content edits, the ONE feedback note, snooze, regenerate (with the server's
 * in-flight stamp polled to completion), the execution-failure hold, and the
 * decision itself — everything `ReviewActionCard` does that is not a `<div>`.
 *
 * Extracted so a page can render the decision in its own type system (the
 * lead page's Detail archetype: sections + a sticky bar) while deciding the
 * SAME run through the SAME calls the card and the queue use. The card keeps
 * its own copy of this logic until PR #337 (which reshapes the card) lands;
 * then `ReviewActionCard` adopts this hook and the duplicate goes.
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
        const s = await client.review.actionStatus({ id: run.id });
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
      const outcome = await client.review.decideAction({
        id: run.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === 'approve' && ce ? { contentEdits: ce } : {}),
        ...(decision === 'approve' && editedInput ? { editedInput } : {}),
      });
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
      await client.review.snoozeAction({
        id: run.id,
        until: until.toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDecided?.('snooze');
    } finally {
      setBusy(false);
    }
  };

  // Regenerate — re-run the work behind the run with the feedback as the
  // instruction. The surface HOLDS ITS PLACE: the server stamps the run, this
  // disables on that truth, and the poll re-enables in place when the new
  // content lands — same run id, zero duplicates.
  const regenerate = async () => {
    setBusy(true);
    try {
      const instruction = note.trim();
      await client.review.regenerateAction({ id: run.id, feedback: instruction });
      setRegen({ since: new Date().toISOString(), note: instruction });
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
