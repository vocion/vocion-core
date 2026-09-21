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
