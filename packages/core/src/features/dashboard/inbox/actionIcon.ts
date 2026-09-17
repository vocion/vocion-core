import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  ClipboardCheck,
  DatabaseZap,
  FileSignature,
  Mail,
  MicVocal,
  Send,
  Sparkles,
  UserRoundPlus,
} from 'lucide-react';

/**
 * The icon for one queue row, chosen by what the row would DO.
 *
 * Rows were iconed by their `InboxKind` — proposal, ruling, input — and on a
 * real queue 136 of 144 rows are the `proposal` kind, so every one of them drew
 * the same clipboard. The kind says how a row is decided; it says nothing about
 * whether approving it writes to a CRM, sends an email, or enrolls somebody in
 * a sequence, which is the thing a person is actually scanning for. Chris,
 * 2026-09-17: *"they're all check list. I should see email, CRM something…"*
 *
 * So the action id picks the icon, and the kind is only the fallback for a row
 * that has no action behind it (a ruling, an input, a suggested rule).
 *
 * Matched on the id's PREFIX — the vendor or capability — so a new
 * `hubspot.*` or `gmail.*` action inherits the right icon without an entry
 * here, and only a genuinely new capability needs one.
 */

/** Longest prefix wins, so `objects.propose_candidate` beats a bare `objects`. */
const BY_PREFIX: ReadonlyArray<readonly [string, LucideIcon]> = [
  ['personalization.enroll', UserRoundPlus],
  ['discovery.review_proposal', MicVocal],
  ['objects.propose_candidate', Boxes],
  ['proposal.send', FileSignature],
  ['hubspot.', DatabaseZap],
  ['gmail.', Mail],
  ['slack.', Send],
  ['personalization.', UserRoundPlus],
  ['discovery.', MicVocal],
  ['objects.', Boxes],
  ['learning.', Sparkles],
];

/**
 * @param actionId - The action the row would run, e.g. `hubspot.update`.
 * @param fallback - The kind's icon, for rows with no action behind them.
 * @returns The icon to draw on the row.
 */
export function actionIcon(actionId: string | undefined, fallback: LucideIcon = ClipboardCheck): LucideIcon {
  if (!actionId) {
    return fallback;
  }
  const id = actionId.toLowerCase();
  let best: { len: number; icon: LucideIcon } | null = null;
  for (const [prefix, icon] of BY_PREFIX) {
    if (id.startsWith(prefix) && (!best || prefix.length > best.len)) {
      best = { len: prefix.length, icon };
    }
  }
  return best?.icon ?? fallback;
}
