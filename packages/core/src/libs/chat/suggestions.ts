/**
 * FOLLOW-UPS — up to three short next asks under an answer, as quiet text
 * pills (founder, 2026-10-09: "Check out chat gpt does up to 3 suggestions.
 * If they are really valuable. And doesn't trap them in cards.").
 *
 * The agent writes them as part of its own reply, in one block at the end:
 *
 *   <suggest>
 *   Draft the reply to Dana
 *   Show who's waiting on me
 *   </suggest>
 *
 * The streamer holds the block back (`services/agents/answerStream.ts`), so
 * it never shows as text, and the turn hands the lines over as one typed
 * `suggestions` event — no second model call, no added latency. Each line is
 * a whole message the person could send next; tapping a pill sends it.
 *
 * Zero is common and fine: the agent writes the block only when a next ask
 * is specific to this answer and worth a tap. The one line `Dig deeper` is a
 * kind of its own — the same question again one effort level up (the turn
 * line's own Dig deeper, `services/agents/effort.ts`) — and the chat shows
 * it only when the turn ran below Deep.
 *
 * A suggestion is never a Decision card: a card is for what an agent wants
 * to DO that needs consent, or a real question with options.
 */

/** At most this many pills under an answer. */
export const MAX_SUGGESTIONS = 3;

/** The longest pill, in characters: a pill is a short ask, never a paragraph. */
export const SUGGESTION_MAX_CHARS = 80;

/** The block's tag. */
export const SUGGEST_TAG = 'suggest';

/** One follow-up: what the pill says, and the message it sends. */
export type Suggestion = {
  label: string;
  prompt: string;
  /** "Dig deeper →": asks the same question again one effort level up. */
  deeper?: true;
  /** Why it is offered, in one line, when the writer said (a brief's actions): the pill's tooltip. */
  why?: string;
};

/** The line the agent writes for "the same question, on the Deep model". */
const DIG_DEEPER_LINE = /^dig deeper\b/i;

/** What a "Dig deeper →" pill sends. */
export const DIG_DEEPER_PROMPT = 'Dig deeper into this';

/**
 * The block's lines as pills: one per line, list marks and quotes dropped,
 * blank and over-long lines left out, each said once, at most three.
 * @param body - The text between `<suggest>` and `</suggest>`.
 */
export function parseSuggestions(body: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s*→\s*$/, '').trim();
    if (!line || line.length > SUGGESTION_MAX_CHARS || out.some(s => s.prompt.toLowerCase() === line.toLowerCase())) {
      continue;
    }
    out.push(DIG_DEEPER_LINE.test(line) ? { label: 'Dig deeper →', prompt: DIG_DEEPER_PROMPT, deeper: true } : { label: line, prompt: line });
    if (out.length === MAX_SUGGESTIONS) {
      break;
    }
  }
  return out;
}

/** A `<suggest>` block anywhere in stored text, closed or cut off at the end. */
const BLOCK = new RegExp(`<${SUGGEST_TAG}>[\\s\\S]*?(?:</${SUGGEST_TAG}>|$)`, 'g');

/**
 * Text without any `<suggest>` block: a turn written another way (an answer
 * pass, a stored row from another loop) never shows one as words.
 * @param text - The answer.
 */
export function stripSuggestBlocks(text: string): string {
  if (!text.includes(`<${SUGGEST_TAG}>`)) {
    return text;
  }
  return text.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * The pills a turn shows: "Dig deeper →" only when there is a level above the
 * one the turn ran at (`services/agents/effort.ts`), so it never offers what
 * the turn already had.
 * @param items - What the turn suggested.
 * @param canGoDeeper - The turn ran below Deep and the surface can re-ask.
 */
export function visibleSuggestions(items: readonly Suggestion[] | undefined, canGoDeeper: boolean): Suggestion[] {
  return (items ?? []).filter(s => !s.deeper || canGoDeeper).slice(0, MAX_SUGGESTIONS);
}

/**
 * The instruction the agent reads, once, beside its output rules.
 */
export const SUGGEST_INSTRUCTION = [
  'FOLLOW-UPS: after your answer you may end with a <suggest> block of 1 to 3 lines, each a short next message the person could send you (under 60 characters, in their voice, imperative): e.g. "Draft the reply to Dana", "Show who\'s waiting on me", "Add this to my morning brief".',
  'Only suggest what is specific to THIS answer and clearly worth a tap; never generic ("Tell me more", "Anything else?"). Zero is common: when nothing clears that bar, write no block.',
  'Write "Dig deeper" as one line only when a deeper pass would materially improve this answer.',
  'A suggestion is never a card or an ask: cards and file_ask are for what you want to DO that needs their consent, or a real question with options.',
  'The block is never shown as text; do not mention it.',
].join(' ');
