/**
 * THE DONE RECEIPT — what the escalation rule says when nothing needed asking.
 *
 * Inside the trust bar and reversible, an agent just does it: no card, no
 * question, one quiet line under the turn — "Done · Moved Northwind to
 * Negotiation" — with Undo ONLY where the action's kind defines one
 * (`libs/actions/undoable.ts`). An email that went out says Done and never
 * Undo, because nothing can unsend it.
 *
 * Pure and client-safe: the route emits it, the transcript draws it, the
 * row's runs keep it across a reload.
 */

export type DoneReceipt = {
  /** The action run that did it. */
  runId: number;
  actionId: string;
  /** What was done, in a few words. */
  label: string;
  /** The kind defines `undo`, so the receipt offers it. */
  undoable: boolean;
  /** The record it touched, when there is one to open. */
  href?: string;
  /** `undone` once a person took it back. */
  status?: 'done' | 'undone';
};

/**
 * A receipt off the wire or the ledger, or null when it is not one.
 * @param raw - Whatever arrived.
 */
export function readDoneReceipt(raw: unknown): DoneReceipt | null {
  const r = raw as Partial<DoneReceipt> | null | undefined;
  if (!r || typeof r.runId !== 'number' || typeof r.actionId !== 'string' || typeof r.label !== 'string' || !r.label.trim()) {
    return null;
  }
  return {
    runId: r.runId,
    actionId: r.actionId,
    label: r.label,
    undoable: r.undoable === true,
    ...(typeof r.href === 'string' && r.href.startsWith('/') ? { href: r.href } : {}),
    ...(r.status === 'undone' ? { status: 'undone' as const } : {}),
  };
}

/**
 * The sentence an agent is handed about a run it did, saying Undo only where
 * it is real. Every done-for-you answer reads this instead of promising.
 * @param undoable - Whether the kind defines undo.
 */
export function undoSentence(undoable: boolean): string {
  return undoable
    ? 'A person can undo it from the Done line under this turn, or from the Review queue\'s Decided tab.'
    : 'It cannot be undone — this kind has no undo — so do not offer one.';
}
