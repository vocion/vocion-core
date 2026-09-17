'use client';

import { useEffect, useRef } from 'react';

/**
 * The seam between the conversation that REWRITES a send and the page that
 * SHOWS it.
 *
 * The rail rewrites — that is the agent's own work, asked for with `@change`
 * and carried out by `ReviewService.rewriteDraft`. The page shows the record,
 * sends included. So when a rewrite lands, the new copy has to reach the page,
 * because the rail is no longer allowed to re-render the sequence to prove it
 * happened (`docs/design/patterns.md`, "The rail is the conversation, never a
 * second copy of the page").
 *
 * A window event rather than a store or a provider, for the same reason
 * `dockState.ts` is one: neither surface holds a reference to the other's
 * internals, and a surface that is not mounted simply does not hear it. The
 * revision is ALSO saved by the guided flow's own state, so a decision taken
 * on the page still carries it (`savedGuidedEdits`) if nothing was listening.
 */

export const DRAFT_REVISED_EVENT = 'vocion:draft-revised';

export type DraftRevised = {
  /** The review run the send belongs to. */
  runId: number;
  /** The content id of the send that was rewritten. */
  contentId: string;
  /** The copy that came back — what the decision now binds to. */
  body: string;
};

/**
 * Announce that a send was rewritten. Safe on the server (does nothing).
 * @param detail - Which send, on which run, and its new copy.
 */
export function publishDraftRevision(detail: DraftRevised): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<DraftRevised>(DRAFT_REVISED_EVENT, { detail }));
}

/**
 * Listen for rewrites landing on one run, and apply them to whatever the page
 * is showing.
 *
 * `apply` is read through a ref, so a caller may pass a fresh closure every
 * render (a decision hook's `editContent` is one) without the listener being
 * torn down and rebound each time.
 * @param runId - The run this page's decision is on.
 * @param apply - Called with the send's content id and its new body.
 */
export function useDraftRevision(runId: number, apply: (contentId: string, body: string) => void): void {
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });
  useEffect(() => {
    const onRevised = (e: Event) => {
      const detail = (e as CustomEvent<DraftRevised>).detail;
      if (!detail || detail.runId !== runId || !detail.contentId) {
        return;
      }
      applyRef.current(detail.contentId, detail.body);
    };
    window.addEventListener(DRAFT_REVISED_EVENT, onRevised);
    return () => window.removeEventListener(DRAFT_REVISED_EVENT, onRevised);
  }, [runId]);
}
