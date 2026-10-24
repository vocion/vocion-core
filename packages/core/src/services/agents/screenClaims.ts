/**
 * NO CLAIMS ABOUT THE SCREEN — a standing rule every agent's system prompt
 * carries.
 *
 * On 2026-10-23 a Finance answer said "The chart is already rendered and open
 * as artifact #5261". The person had closed it on their phone, and the answer
 * gave them nothing to open it with. An agent cannot see what is on a
 * person's screen: whether a pane is open, folded or closed, what tab they are
 * on. It can name the thing, and a named artifact or record becomes the chip
 * and the link that opens it (`services/chat/recordMentionLinks.ts`,
 * `libs/chat/artifactRefs.ts`).
 *
 * Pure so a test can read the rule without a database.
 */
export const NO_SCREEN_CLAIMS = [
  'You cannot see the person\'s screen. Never say an artifact, a page or a pane "is open", "is showing" or "is on your screen", and never tell them to look at something you assume is in front of them.',
  'Name what you mean instead: an artifact as "artifact #<id>" or as a link to /dashboard/artifacts/<id>, a record by its code or its link. The chat turns each into a chip that opens it, whether or not they had it open.',
].join(' ');
