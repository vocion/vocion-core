import type { ReviewShortcut } from '@/features/review/reviewShortcuts';
import type { InboxKind } from '@/services/InboxService';

/**
 * ONE decision model for the whole "Review queue" surface. Every kind of row
 * maps to the verbs a person can take on it; the sticky bar on the detail
 * screen, the hover verbs on a list row and the keyboard all read from here,
 * so a verb is never spelled one way on the row and another on the page.
 *
 *   proposal   Approve · Edit-and-approve (edits travel with Approve) · Snooze · Decline, plus Regenerate beside the item it regenerates
 *   ask        the ask's own options + Other — the option rows ARE the verbs; the bar carries Submit
 *   run        Resume · Cancel (missions, workflows); a worker run only opens
 *   learning   Adopt · Reject
 *
 * Pure data. `reviewShortcuts` owns the key → action map; this table says
 * which of those actions a kind answers to, and what the key does there.
 */

/**
 * `skip` and `save` are gone from the table: Skip was a second name for
 * navigation `j` and `k` already do, and Save for later meant "leave it
 * pending", which is what changing nothing already means. A verb that does
 * what doing nothing does is an option, not an action (design principle 4).
 */
export type DecisionVerbId = 'approve' | 'reject' | 'snooze' | 'regenerate' | 'submit' | 'resume' | 'cancel';

export type DecisionVerb = {
  id: DecisionVerbId;
  label: string;
  /** The single key that fires it on the detail screen, when there is one. */
  shortcut?: 'a' | 'd' | 's';
  /** Ghost by default; `danger` reddens on hover. */
  tone?: 'ghost' | 'danger';
  /** Shown as a hover verb on the list row. */
  onRow?: boolean;
};

export type KindVerbs = {
  primary: DecisionVerb;
  secondary: DecisionVerb[];
  /** What the row's quick verbs are called, when the kind has any. */
  row: DecisionVerb[];
};

const APPROVE: DecisionVerb = { id: 'approve', label: 'Approve', shortcut: 'a', onRow: true };
const DECLINE: DecisionVerb = { id: 'reject', label: 'Decline', shortcut: 'd', tone: 'danger', onRow: true };
const REJECT: DecisionVerb = { id: 'reject', label: 'Reject', shortcut: 'd', tone: 'danger', onRow: true };
const SNOOZE: DecisionVerb = { id: 'snooze', label: 'Snooze', shortcut: 's' };
const SUBMIT: DecisionVerb = { id: 'submit', label: 'Submit' };
const RESUME: DecisionVerb = { id: 'resume', label: 'Resume', shortcut: 'a' };
const CANCEL: DecisionVerb = { id: 'cancel', label: 'Cancel run', shortcut: 'd', tone: 'danger' };
const ADOPT: DecisionVerb = { id: 'approve', label: 'Adopt as rule', shortcut: 'a', onRow: true };
const RETRY: DecisionVerb = { id: 'resume', label: 'Retry the task', shortcut: 'a' };
const STOP: DecisionVerb = { id: 'cancel', label: 'Stop trying', shortcut: 'd', tone: 'danger' };

const ASK: KindVerbs = { primary: SUBMIT, secondary: [], row: [APPROVE, REJECT] };

/**
 * The verbs for each kind. Asks share one entry: their options are the
 * verbs, and the row's quick Approve / Reject stand in for an ask that names
 * no options of its own.
 */
export const DECISION_VERBS: Record<InboxKind, KindVerbs> = {
  proposal: { primary: APPROVE, secondary: [DECLINE, SNOOZE], row: [APPROVE, DECLINE] },
  ruling: ASK,
  approval: ASK,
  merge: ASK,
  input: ASK,
  credential: ASK,
  gate: ASK,
  recommendation: ASK,
  run: { primary: RESUME, secondary: [CANCEL], row: [] },
  learning: { primary: ADOPT, secondary: [REJECT], row: [ADOPT, REJECT] },
  // An exception is answered on its run, retry it, or stop trying, so the
  // row carries no quick verb it could not honour from the list.
  exception: { primary: RETRY, secondary: [STOP], row: [] },
};

/**
 * Which verb a keyboard shortcut fires for a kind, or null when the kind does
 * not answer to that key (an ask has no `a` — its options are chosen, not
 * approved; `j`/`k` walk the queue regardless of kind and are not verbs).
 * @param kind
 * @param action - The shortcut `reviewShortcuts.shortcutFor` resolved.
 */
export function verbForShortcut(kind: InboxKind, action: ReviewShortcut): DecisionVerb | null {
  const key = action === 'approve' ? 'a' : action === 'decline' ? 'd' : action === 'snooze' ? 's' : null;
  if (!key) {
    return null;
  }
  const v = DECISION_VERBS[kind];
  return [v.primary, ...v.secondary].find(verb => verb.shortcut === key) ?? null;
}

/**
 * The quick verbs a list row shows on hover for a kind — nothing for a sheet
 * (it opens) or a run (it resumes from its own screen).
 * @param kind
 * @param shape
 */
export function rowVerbs(kind: InboxKind, shape: 'single' | 'sheet'): DecisionVerb[] {
  return shape === 'sheet' ? [] : DECISION_VERBS[kind].row;
}
