'use client';

import type { GuidedSend, GuidedState } from './guidedFlow';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { useCallback, useState } from 'react';
import { client } from '@/libs/Orpc';
import {
  applyRevision,
  canDecide,
  contentEditsFor,
  currentBody,
  initialGuidedState,
  isRevisionAsk,
  markRead,
  revisionList,
  sendsFromCard,
  targetOf,
  versionOf,
} from './guidedFlow';

/**
 * Guided review: the decision walked one send at a time, in the conversation
 * beside the lead.
 *
 * The page carries the brief and the decision context; this carries the
 * review itself — an overview, a card per send, then the decision. Every card
 * is derived from the run's own content, so the flow cannot drift from what
 * is being approved, and the verbs are the review card's verbs on the review
 * card's decide path: guided review is a way of taking the decision, never a
 * second authority over it.
 */

/**
 * What became of an ask. `revised` is the only one that changes the copy —
 * the rest leave the drafts exactly as the reviewer last saw them.
 */
export type AskResult
  = | { kind: 'question' }
    | { kind: 'revised'; send: GuidedSend }
    | { kind: 'unchanged'; send: GuidedSend }
    | { kind: 'failed'; send: GuidedSend };

export type GuidedReviewProps = {
  run: ReviewCardRun;
  /** Fired after a decision lands, so the page can re-resolve the run. */
  onDecided?: (outcome: 'approve' | 'reject' | 'snooze') => void;
};

/**
 * Everything the dock needs to render and drive one guided review.
 * @param root0
 * @param root0.run
 * @param root0.onDecided
 */
export function useGuidedReview({ run, onDecided }: GuidedReviewProps) {
  const sends = sendsFromCard(run.card);
  // Dropped straight into the first send: a reviewer who opened a lead with a
  // decision waiting has nothing to press before reviewing starts. Derived
  // from the run rather than set by an effect, so there is no frame where the
  // flow exists but has not begun.
  const [state, setState] = useState<GuidedState>(() => (
    sends.length > 0 ? { ...initialGuidedState, step: 0 } : initialGuidedState
  ));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ decision: string; detail: string } | null>(null);

  const advance = useCallback(() => setState(s => ({ ...s, step: s.step + 1 })), []);
  const reread = useCallback((contentId: string) => setState(s => markRead(s, contentId)), []);

  /**
   * An ask from the composer. A revision is applied to its send and that send
   * is re-presented; a question is left for the agent to answer and changes
   * nothing.
   * @param text - What the reviewer typed.
   * @returns What became of the ask.
   */
  const askAbout = useCallback(async (text: string): Promise<AskResult> => {
    if (!isRevisionAsk(text) || state.decided) {
      return { kind: 'question' };
    }
    const target = targetOf(text, sends, state);
    if (!target) {
      return { kind: 'question' };
    }
    setBusy(true);
    try {
      const res = await client.review.rewriteDraft({ runId: run.id, hint: text, contentId: target.id });
      // A rewrite that changed nothing is not a revision. Recording one would
      // put a change in the recap that the reviewer never got, and the recap
      // is the record of what they approved.
      if (res.body.trim() === currentBody(target, state).trim()) {
        return { kind: 'unchanged', send: target };
      }
      setState(s => applyRevision(s, sends, target.id, res.body, text));
      return { kind: 'revised', send: target };
    } catch (error) {
      // The ask still reaches the agent as a message, so nothing is lost;
      // what must not happen is the copy claiming to have changed.
      console.warn('guided review: rewrite failed', error);
      return { kind: 'failed', send: target };
    } finally {
      setBusy(false);
    }
  }, [run.id, sends, state]);

  /**
   * Decide. The same routes the review card calls, on the same run, carrying
   * the revisions as content edits — so the copy that persists is the copy
   * the reviewer read.
   * @param decision - Enroll, decline, or snooze.
   * @param note - Required for a decline.
   * @returns Nothing; the outcome card renders the result.
   */
  const decide = useCallback(async (decision: 'approve' | 'reject' | 'snooze', note?: string) => {
    setBusy(true);
    try {
      if (decision === 'snooze') {
        const until = new Date(Date.now() + 86_400_000);
        await client.review.snoozeAction({ id: run.id, until: until.toISOString(), ...(note ? { note } : {}) });
        setOutcome({ decision: 'Snoozed', detail: `The card returns ${until.toLocaleDateString()}. The lead stays ready for review.` });
      } else {
        const edits = contentEditsFor(state, sends);
        await client.review.decideAction({
          id: run.id,
          decision,
          ...(note ? { note } : {}),
          ...(decision === 'approve' && edits.length > 0 ? { contentEdits: edits } : {}),
        });
        setOutcome(decision === 'approve'
          ? { decision: 'Enrolled', detail: 'Day 1 sends today. This page now shows the record rather than a form.' }
          : { decision: 'Declined', detail: 'Nothing was enrolled. Your note goes to the agent as the reason.' });
      }
      setState(s => ({ ...s, decided: true }));
      onDecided?.(decision);
    } catch (error) {
      // Most often: someone decided this lead somewhere else while it was
      // being read. The flow ends with what happened rather than pretending
      // the decision is still open.
      console.warn('guided review: decide failed', error);
      setOutcome({ decision: 'Already decided', detail: 'This lead was decided elsewhere. Reload the page for its record.' });
      setState(s => ({ ...s, decided: true }));
    } finally {
      setBusy(false);
    }
  }, [run.id, state, sends, onDecided]);

  const revisions = revisionList(state, sends);

  return {
    sends,
    state,
    busy,
    outcome,
    advance,
    reread,
    askAbout,
    decide,
    revisions,
    canDecide: canDecide(state, sends),
    /** The send under review, or null before the walk starts or after it ends. */
    current: state.step >= 0 && state.step < sends.length ? sends[state.step]! : null,
    bodyOf: (send: GuidedSend) => currentBody(send, state),
    versionOf: (send: GuidedSend) => versionOf(send, state),
  };
}

/**
 * A card in the flow, in the transcript's own quiet language.
 * @param root0
 * @param root0.eyebrow
 * @param root0.title
 * @param root0.children
 * @param root0.actions
 */
export function GuidedCard({ eyebrow, title, children, actions }: {
  eyebrow: string;
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3 text-[13px] shadow-sm">
      <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{eyebrow}</div>
      {title && <div className="mt-0.5 text-[13.5px] font-bold">{title}</div>}
      {children}
      {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A short list; the cards are scanned, not read.
 * @param root0
 * @param root0.items
 */
export function GuidedList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-2 list-disc pl-4">
      {items.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key -- static, order-stable lines
        <li key={i} className="mb-0.5 last:mb-0">{item}</li>
      ))}
    </ul>
  );
}
