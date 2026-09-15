import type { AskOption } from '@/models/Schema';

/**
 * Ask option vocabulary, shared by the client sheet and the server-rendered
 * receipt.
 *
 * This lived inside `AskSheet.tsx` until 2026-09-15, which is a `'use client'`
 * module: importing `labelFor` from a server component turned it into a client
 * reference, and calling it threw "Attempted to call labelFor() from the
 * server". Nothing caught it until a group had its first DECIDED ask, because
 * the receipt only renders for decided rows — so the group page rendered fine
 * for months and then crashed on the live instance the moment someone answered
 * a question in it. A function two render environments both need belongs in
 * neither one's module.
 */

/** The option id that means "answer in your own words". */
export const OTHER = 'other';

/** The rows shown when an ask names no options of its own. */
export const FIXED_ROWS: AskOption[] = [
  { id: 'approve', label: 'Approve', description: 'Yes — go ahead as proposed.' },
  { id: 'reject', label: 'Reject', description: 'No — do not do this.' },
  { id: 'done', label: 'Mark done', description: 'Handled outside Vocion; nothing more to do here.' },
];

/**
 * The human label for a recorded decision on this ask.
 * @param ask - Anything carrying the ask's options.
 * @param decision - The stored decision id.
 */
export function labelFor(ask: { options: AskOption[] }, decision: string): string {
  if (decision === OTHER) {
    return 'Other';
  }
  const own = ask.options.find(o => o.id === decision);
  if (own) {
    return own.label;
  }
  const fixed = FIXED_ROWS.find(o => o.id === decision);
  return fixed?.label ?? decision;
}
