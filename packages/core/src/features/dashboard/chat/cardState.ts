/**
 * What a card an earlier turn put up came to, in one clause — read back under
 * that turn (`decisions/CardHistory.tsx`). Cards are not drawn anymore: a
 * person decides in the docked Decision; this keeps the record of the ones
 * that were.
 */

export type CardStateInput = {
  /** The run's status, or null when nothing is filed yet. */
  status: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  approvedByAgent?: boolean;
  /** The turn tried to file the card and could not (`card_update` state `unfiled`); nothing is in Review. */
  unfiled?: boolean;
  /** What a done run did, or what Undo took back, from its result — "changed request #124: outcome, mainRisk". */
  summary?: string | null;
  /** The filing misses its type's bar; nothing is filed until a draft is written. */
  draft?: boolean;
  /** A ruling's answer: the option, and whether the trust bar chose it. */
  choice?: { label: string; byTrustBar: boolean } | null;
};

/**
 * The card's state as ONE clause — who has it and what happened. It used to
 * be assembled from four fragments ("Done · approved by … · Undo · filed by
 * the agent within bounds"), which read as both auto-approved and approved by
 * a person at once. Filing and deciding are different facts: filing is
 * bookkeeping, deciding is the state.
 * @param s - What the run says.
 * @param time - Formats `decidedAt`.
 */
export function describeCardState(s: CardStateInput, time: (iso: string) => string): { label: string; tone: 'muted' | 'amber' | 'green' | 'red' } {
  const by = s.decidedBy ? ` by ${s.decidedBy}` : '';
  const at = s.decidedAt ? ` · ${time(s.decidedAt)}` : '';
  // A card that was meant to be filed and was not is not waiting on anyone:
  // "Waiting on you" over no action run was a promise (conversation 349).
  if (s.unfiled && s.status === null) {
    return { label: 'Not filed', tone: 'red' };
  }
  // A filing that misses its bar is not waiting on a decision — it is
  // waiting on a draft, and the card's one button asks for it.
  if (s.draft && s.status === null) {
    return { label: 'Draft needed', tone: 'amber' };
  }
  // DONE SAYS WHAT WAS DONE (Chris, 2026-09-28: "Done for you · Undo" did not
  // telegraph that it had already run). The run's own result names it.
  const did = s.summary?.trim() ? ` — ${s.summary.trim()}` : '';
  switch (s.status) {
    case null:
    case 'pending':
      return { label: 'Waiting on you', tone: 'amber' };
    case 'executing':
      return s.approvedByAgent
        ? { label: 'Done for you · running', tone: 'amber' }
        : { label: `Approved${by} · running`, tone: 'amber' };
    case 'done':
      // A ruling reads as its answer: the option, and who chose it.
      if (s.choice) {
        return { label: s.choice.byTrustBar ? `Chose ${s.choice.label} for you` : `You chose ${s.choice.label}`, tone: 'green' };
      }
      return s.approvedByAgent
        ? { label: `Done for you${did}`, tone: 'green' }
        : { label: `Approved${by}${at}${did}`, tone: 'green' };
    case 'rejected':
      return { label: `Rejected${by}${at}`, tone: 'red' };
    case 'undone':
      // What Undo took back, when it was more than the card shows (a source and its documents).
      return { label: `Undone${by}${at}${did}`, tone: 'muted' };
    case 'closed':
      // The review sweep closed it: nobody decided, its reason was gone.
      return { label: `Closed — no longer needed${at}`, tone: 'muted' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'snoozed':
      return { label: 'Deferred', tone: 'muted' };
    default:
      return { label: s.status, tone: 'muted' };
  }
}
