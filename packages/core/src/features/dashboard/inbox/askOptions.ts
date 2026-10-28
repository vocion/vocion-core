import type { AskOption, AskOutcomes } from '@/models/Schema';

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

/**
 * What each answer on an ask starts, by decision id: the names of the
 * automations and workflows subscribed to `ask.decided` whose filter the
 * answer matches. Computed on the server (`services/inbox/answerListeners`);
 * an empty list means nothing runs. Absent means the page did not look.
 */
export type AnswerListeners = Record<string, string[]>;

/**
 * WHAT AN ANSWER DOES, said before it is given (Chris, 2026-09-29, ruling
 * #145: "there's nothing 'Proposed' in this Ruling. what is it going to do if
 * I hit approve? make that clear"). Deciding an ask runs nothing by itself:
 * the answer is recorded, and only an automation subscribed to it acts. So
 * the sentence is read off `listeners`, never assumed. When the page did not
 * look, it says only what is certain.
 * The asker's own line wins (`ask.outcomes`): an ask whose answer resumes
 * work says what happens ("The briefs start"), never "nothing runs".
 * @param ask - The asker, for "recorded for …".
 * @param ask.agentSlug
 * @param ask.outcomes - What each answer does, when the asker said.
 * @param decision - The decision id.
 * @param listeners - What each answer starts, when the page looked.
 */
export function consequenceOf(ask: { agentSlug: string | null; outcomes?: AskOutcomes | null }, decision: string, listeners?: AnswerListeners): string {
  // The asker said what this answer does: an answer that resumes its work.
  const said = outcomeLine(ask.outcomes, decision);
  if (said) {
    return said;
  }
  const names = listeners?.[decision];
  if (names && names.length > 0) {
    return `Starts ${names.map(n => `“${n}”`).join(' and ')}.`;
  }
  const recorded = `Your answer is recorded for ${ask.agentSlug ?? 'whoever asked'}`;
  return names ? `${recorded}; nothing runs on its own.` : `${recorded}.`;
}

/**
 * The line an ask carries for one answer, or null: Approve's for `approve`,
 * Revise's for an answer in a person's words (`other`), Reject's for `reject`.
 * @param outcomes - The ask's lines.
 * @param decision - The decision id.
 */
export function outcomeLine(outcomes: AskOutcomes | null | undefined, decision: string): string | null {
  const line = decision === 'approve' ? outcomes?.onApprove : decision === OTHER ? outcomes?.onRevise : decision === 'reject' ? outcomes?.onReject : undefined;
  return line?.trim() ? line.trim() : null;
}

/**
 * The rows shown when an ask names no options of its own. When it names
 * options, those ARE the choices and these never replace them. Each
 * description says what that answer does (`consequenceOf`). None of them
 * says "as proposed", because an ask with no options proposes nothing.
 * @param ask - The asker.
 * @param ask.agentSlug
 * @param ask.outcomes
 * @param listeners - What each answer starts, when the page looked.
 */
export function fixedRowsFor(ask: { agentSlug: string | null; outcomes?: AskOutcomes | null }, listeners?: AnswerListeners): AskOption[] {
  return [
    { id: 'approve', label: 'Approve', description: `Yes. ${consequenceOf(ask, 'approve', listeners)}` },
    { id: 'reject', label: 'Reject', description: `No. ${consequenceOf(ask, 'reject', listeners)}` },
    { id: 'done', label: 'Mark done', description: `Already handled outside Vocion. ${consequenceOf(ask, 'done', listeners)}` },
  ];
}

/** The fixed rows' ids and labels, for reading a recorded decision back. */
export const FIXED_ROWS: AskOption[] = fixedRowsFor({ agentSlug: null });

/**
 * The human label for a recorded decision on this ask.
 * @param ask - Anything carrying the ask's options.
 * @param ask.options
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
