import type { ChatMessage } from './types';

/**
 * The thread as plain text, for taking out of the product.
 *
 * A conversation here is where the reasoning, the figures and the decision
 * already live, and until now the only way to get one out was to select it by
 * hand — on a phone, across message bubbles, tool rows and a live trace, which
 * is not a thing anybody succeeds at. Chris, 2026-09-22: *"I want a copy chat
 * menu item."*
 *
 * What it writes is what a person would want pasted into a ticket or a note:
 * who said what, in order, with the agent named. Tool steps and traces are
 * deliberately left out — they are the machinery, they are enormous, and a
 * transcript nobody can read in the destination has not been copied anywhere
 * useful.
 *
 * Pure, so it can be tested without a browser or a clipboard.
 * @param messages - The thread, oldest first.
 * @param agentName - What to call the assistant; falls back to a plain word.
 */
export function transcriptOf(messages: ChatMessage[], agentName?: string | null): string {
  const who = (m: ChatMessage): string => (m.role === 'user' ? 'You' : (agentName?.trim() || 'Assistant'));
  return messages
    .map((m) => {
      const body = m.content.trim();
      // A turn can be all tool work and no prose. Say so rather than emitting
      // a name followed by nothing, which reads as a bug in the copy.
      return `${who(m)}:\n${body === '' ? '(no message — this turn was tool work only)' : body}`;
    })
    .join('\n\n');
}
