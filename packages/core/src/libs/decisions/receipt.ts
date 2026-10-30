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
  /** `undone` once a person took it back; `failed` when it did not run (`error` says why). */
  status?: 'done' | 'undone' | 'failed';
  /** Why it did not run, in the system's words, when `status` is `failed`. */
  error?: string;
  /**
   * The record it changed, by name; the name is the link (no separate pill):
   * in the app, or the record's own page in the system it lives in.
   */
  record?: { label: string; href?: string };
  /** It made the record rather than changing one: the line says "created". */
  created?: boolean;
  /** What changed on it, old → new, when the run says. */
  changes?: ReceiptChange[];
  /** What the action itself says it did ("Pull request opened" and its link), from its result's `receipt`. */
  outcome?: { text: string; href?: string; linkLabel?: string };
  /** Why it ran without a card, for a tooltip — never in the line. */
  why?: string;
};

/** One field a run changed. */
export type ReceiptChange = { field: string; from?: string | null; to: string };

/** At most this many changes are named on the line. */
const CHANGES_SHOWN = 4;

/**
 * The changes, as the line reads them: "Deal stage: Proposal → Contract sent".
 * @param changes - What changed.
 */
export function changesText(changes: readonly ReceiptChange[]): string {
  const shown = changes.slice(0, CHANGES_SHOWN).map(c => `${c.field}: ${c.from !== undefined && c.from !== null && c.from !== '' ? `${c.from} → ` : ''}${c.to}`);
  return `${shown.join(', ')}${changes.length > CHANGES_SHOWN ? ` +${changes.length - CHANGES_SHOWN} more` : ''}`;
}

/**
 * What the run did to its record, as the line says it.
 * @param r - The receipt.
 */
export function receiptVerb(r: Pick<DoneReceipt, 'created'>): 'created' | 'updated' {
  return r.created ? 'created' : 'updated';
}

/**
 * Why a run failed, as one short clause: the system's own message without
 * its JSON body ("HubSpot update failed: HubSpot API error 404: {…}" →
 * "HubSpot update failed: HubSpot API error 404").
 * @param error - The run's error.
 */
export function failureReason(error: string): string {
  const cut = error.split(/:\s*[{[]/)[0]!.trim();
  return cut.length > 140 ? `${cut.slice(0, 137)}…` : cut;
}

/**
 * The Done line in words, as it renders (the record name and the outcome's
 * link are links there): "Done. Northwind renewal updated: Deal stage:
 * Proposal → Contract sent". One line, one Undo beside it; no run code, no
 * explanation of why it ran.
 * @param r - The receipt.
 */
export function receiptText(r: DoneReceipt): string {
  if (r.status === 'failed') {
    return `Didn't run. ${r.record?.label ?? r.label}${r.error ? `: ${r.error}` : ''}`;
  }
  const head = r.status === 'undone' ? 'Undone.' : 'Done.';
  if (r.outcome) {
    return `${head} ${r.outcome.text}${r.outcome.href ? `: ${r.outcome.linkLabel ?? r.outcome.href}` : ''}`;
  }
  if (r.record && r.changes && r.changes.length > 0) {
    return `${head} ${r.record.label} ${receiptVerb(r)}: ${changesText(r.changes)}`;
  }
  if (r.record && r.created) {
    return `${head} ${r.record.label} created`;
  }
  return `${head} ${r.label}`;
}

/**
 * The `receipt` an action's result carries, when it says one: what it did in
 * a few words and the link to the thing it made.
 * @param result - The run's result.
 */
export function outcomeOf(result: unknown): DoneReceipt['outcome'] | undefined {
  const raw = (result as { receipt?: unknown } | null)?.receipt as { text?: unknown; href?: unknown; linkLabel?: unknown } | undefined;
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) {
    return undefined;
  }
  const href = typeof raw.href === 'string' && (raw.href.startsWith('/') || /^https:\/\//.test(raw.href)) ? raw.href : undefined;
  return { text: raw.text.trim().slice(0, 160), ...(href ? { href } : {}), ...(href && typeof raw.linkLabel === 'string' && raw.linkLabel.trim() ? { linkLabel: raw.linkLabel.trim().slice(0, 120) } : {}) };
}

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
    ...(r.status === 'undone' || r.status === 'failed' ? { status: r.status } : {}),
    ...(r.status === 'failed' && typeof r.error === 'string' && r.error.trim() ? { error: r.error } : {}),
    ...(r.record && typeof r.record.label === 'string' && r.record.label.trim() ? { record: { label: r.record.label, ...(typeof r.record.href === 'string' && (r.record.href.startsWith('/') || /^https:\/\//.test(r.record.href)) ? { href: r.record.href } : {}) } } : {}),
    ...(r.created === true ? { created: true } : {}),
    ...(Array.isArray(r.changes) ? { changes: r.changes.filter(c => c && typeof c.field === 'string' && typeof c.to === 'string').map(c => ({ field: c.field, to: c.to, ...(typeof c.from === 'string' ? { from: c.from } : {}) })) } : {}),
    ...(outcomeOf({ receipt: r.outcome }) ? { outcome: outcomeOf({ receipt: r.outcome }) } : {}),
    ...(typeof r.why === 'string' && r.why.trim() ? { why: r.why } : {}),
  };
}

/**
 * The sentence an agent is handed about a run it did, saying Undo only where
 * it is real. Every done-for-you answer reads this instead of promising.
 * @param undoable - Whether the kind defines undo.
 */
export function undoSentence(undoable: boolean): string {
  return undoable
    ? 'The Done line under your reply says what changed, links the record and offers Undo.'
    : 'It cannot be undone — this kind has no undo — so do not offer one.';
}
