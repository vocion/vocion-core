/**
 * Normalise the model's answer text for a Markdown renderer that escapes raw
 * HTML. On 2026-09-18 a reply carried a literal `<br>` between paragraphs and
 * the transcript printed it as text. A `<br>` is a line break, so it becomes
 * Markdown's hard break (two spaces and a newline); nothing else is touched —
 * code spans and fences are left alone by only matching the tag itself.
 * @param text - The answer as the model wrote it.
 */
export function normalizeAnswerHtml(text: string): string {
  return text.replace(/<br\s*\/?>/gi, '  \n');
}

/**
 * A line the card pass used to add under an answer for a decision that could
 * not be a card: `- **Label** — not a card: why.` The person could not act on
 * it (Chris, 2026-09-29: "File factory filing bug — not a card: its input does
 * not fit ask.file: title: …"), so no new turn carries one and a stored turn
 * that does is shown without it. The reason is on the tool_call row.
 */
const CARD_NOTE = /^- \*\*[^\n]*?\*\* — not a card: [^\n]*(?:\n|$)/gm;

/**
 * The answer without the card pass's "not a card" lines, and without the
 * blank lines they leave behind.
 * @param text - The answer as stored.
 */
export function stripCardNotes(text: string): string {
  if (!text.includes('— not a card: ')) {
    return text;
  }
  return text.replace(CARD_NOTE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}
