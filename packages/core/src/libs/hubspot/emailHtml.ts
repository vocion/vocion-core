/**
 * Plain text → the HTML HubSpot's email surfaces render.
 *
 * The nurture slot properties and `hs_note_body` are dropped into HTML
 * (the sequence template, the timeline note), where a bare newline collapses
 * to a space — a four-paragraph send arrives as one run-on block. Drafts stay
 * plain text everywhere a person reads or edits them; this runs once, at the
 * HubSpot write boundary. Blank lines split paragraphs, single newlines break
 * lines, and the text is escaped so a drafted `<` never becomes markup.
 * @param text
 */
export function textToEmailHtml(text: string): string {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p.replaceAll('\n', '<br>')}</p>`)
    .join('');
}
