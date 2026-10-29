import { looksLikeId } from '@/libs/preview/evidenceRef';
/**
 * Pure helpers behind the Review page header: the type chips, the queue
 * position line and the item title. Kept free of React so the header's
 * wording is testable without a browser.
 */

/** One pending card type for the org, with its real count and registered name. */
export type ReviewType = { actionId: string; label: string; count: number };

/**
 * Toggle one type in the active filter. Chips are multi-select — several card
 * types can be worked as one queue — and toggling the last one off returns to
 * "All".
 * @param active - Currently selected action ids.
 * @param actionId - The chip that was clicked.
 */
export function toggleType(active: readonly string[], actionId: string): string[] {
  return active.includes(actionId) ? active.filter(a => a !== actionId) : [...active, actionId];
}

/**
 * The registered human name for an action id ("Update HubSpot record"), or
 * the id itself when the server did not name it.
 * @param types - The pending types the server returned.
 * @param actionId - The action to label.
 */
export function typeLabel(types: readonly ReviewType[], actionId: string): string {
  return types.find(t => t.actionId === actionId)?.label ?? actionId;
}

/**
 * "3 of 213" — where the person is in the queue they are working. Position is
 * 1-based within the loaded window; `total` is the queue's real size so a page
 * of fifty out of five hundred never reads as fifty.
 * @param index - Index of the current item in the loaded queue (0-based), or -1.
 * @param total - Real queue size from the server.
 */
export function queuePosition(index: number, total: number): string {
  if (total <= 0) {
    return '';
  }
  const pos = index < 0 ? 1 : Math.min(index + 1, total);
  return `${pos} of ${total}`;
}

/**
 * The H1 of a Review item: WHO or WHAT, in plain words — "Dana Reyes · VP
 * Operations, Kestrel Capital" — never the action's type, an em dash, or an
 * id (an enroll card read "Enroll MQL in sequence — Rob … · 157863368",
 * 2026-10-29: the company field held a CRM id). The verb is the decision
 * line's, under it. With no subject the card's own title stands. Pure.
 * @param opts - The item.
 * @param opts.label
 * @param opts.title - The card's title, for an item with no subject.
 * @param opts.subject - Who it is about.
 * @param opts.subject.name
 * @param opts.subject.role
 * @param opts.subject.company
 */
export function itemTitle(opts: { label?: string; title: string; subject?: { name: string; role?: string; company?: string } }): string {
  if (!opts.subject) {
    return opts.title;
  }
  const company = opts.subject.company && !looksLikeId(opts.subject.company) ? opts.subject.company : undefined;
  const role = opts.subject.role && !looksLikeId(opts.subject.role) ? opts.subject.role : undefined;
  const about = [role, company].filter(Boolean).join(', ');
  return about ? `${opts.subject.name} · ${about}` : opts.subject.name;
}
