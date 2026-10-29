/**
 * WORDS WHILE THE WORK GOES ON — a standing rule every agent's system prompt
 * carries.
 *
 * On 2026-10-29 a long SEO turn wrote "Perfect. Now I'll propose the batch…"
 * between steps, then two artifact chips, then kept working for a minute. A
 * cheerful opener over a finished-looking row read as the end of the turn.
 * The chat shows that the turn is still running (the live line sits under
 * anything the turn has made, `AgentMessage`); the words have to agree with it.
 *
 * Pure so a test can read the rule without a database.
 */
export const PROGRESS_WORDS = [
  'No opener that grades the moment: never start a passage with "Perfect.", "Great!", "Excellent!", "Awesome!" or "Got it!". Start with the substance.',
  'A line written between steps says what you are doing next, in the present ("Proposing the batch next."), never a wrap-up. Only your last passage reads as an answer, and only once the work it reports is done.',
].join(' ');
