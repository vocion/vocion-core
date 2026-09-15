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
 * The page title for one item: the type in plain words, then who or what it
 * is about — "Enroll MQL in sequence — Dale Heim · Agentix". Falls back to the
 * card's own title when there is no subject.
 * @param opts - The type label plus the card's title and subject.
 * @param opts.label
 * @param opts.title
 * @param opts.subject
 * @param opts.subject.name
 * @param opts.subject.company
 */
export function itemTitle(opts: { label: string; title: string; subject?: { name: string; company?: string } }): string {
  if (!opts.subject) {
    return opts.title;
  }
  const who = opts.subject.company ? `${opts.subject.name} · ${opts.subject.company}` : opts.subject.name;
  return `${opts.label} — ${who}`;
}
