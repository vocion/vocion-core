/**
 * The SHAPE of an email body, with no dependencies: what tags it may carry,
 * whether a given body is HTML, and how prose becomes paragraphs.
 *
 * Split from `emailBody.ts` for one reason: that module sanitizes, and its
 * sanitizer is a Node library. The editor is a client component and needs the
 * same answer to "is this HTML" and the same text-to-paragraph rule, so those
 * live here where both sides can import them and neither pulls a server
 * dependency into the browser bundle.
 */

/**
 * What a send's body may contain: the marks an email needs and nothing else.
 *
 * Deliberately small. Every tag here survives a HubSpot email template and a
 * plain-text fallback; headings, images, tables and styles do not, and an
 * editor that offered them would let a reviewer compose something the send
 * cannot carry.
 */
export const EMAIL_TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li'] as const;

/** Any tag at all; whether it is one of ours is decided against the list. */
const ANY_TAG = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;

/**
 * Whether this body carries markup, and is therefore HTML rather than prose.
 *
 * One definition, because the alternative is every reader inventing its own
 * and two of them disagreeing about the same string. A body an agent wrote
 * has no tags and reads as text; a body a reviewer formatted has at least a
 * `<p>`, because that is what the editor emits for a paragraph.
 * @param body - The stored body.
 */
export function isHtmlBody(body: string): boolean {
  for (const [, name] of body.matchAll(ANY_TAG)) {
    if ((EMAIL_TAGS as readonly string[]).includes(name!.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Prose → the HTML the editor and HubSpot both understand.
 *
 * Blank lines split paragraphs and single newlines break lines, which is the
 * shape `textToEmailHtml` has always produced; the escaping is what stops a
 * drafted `<` becoming markup.
 * @param text - Plain text.
 */
export function textToParagraphs(text: string): string {
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

/**
 * The words out of a body, whatever shape it is in: what the voice rules
 * read, and what a plain-text fallback sends.
 *
 * Deliberately NOT the sanitizer. The output here is plain text matched by
 * regex and never rendered, so it needs no security-grade parse — and
 * keeping `sanitize-html` out of this module keeps it out of the workspace
 * applier's import graph, which runs on an older Node than that package
 * declares support for.
 *
 * Block boundaries become blank lines and `<br>` a single newline, so the
 * shape of the message survives and a lint message can still quote a
 * recognisable span.
 * @param body - The stored body, prose or HTML.
 */
export function emailBodyText(body: string): string {
  if (!isHtmlBody(body)) {
    return body;
  }
  return decodeEntities(
    body
      .replaceAll(/<br\s*\/?>/gi, '\n')
      .replaceAll(/<li\b[^>]*>/gi, '• ')
      .replaceAll(/<\/(p|li|ul|ol)>/gi, '\n\n')
      .replaceAll(/<[^>]+>/g, ''),
  )
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The handful of entities the editor and `textToParagraphs` produce.
 * @param s
 */
function decodeEntities(s: string): string {
  return s
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'')
    .replaceAll('&amp;', '&');
}
