/**
 * What an email body IS, now that a reviewer can format one.
 *
 * A send's `body` used to be plain text everywhere, converted to HTML once at
 * the HubSpot write (`libs/hubspot/emailHtml.ts`). A reviewer who wanted a
 * bold phrase or a link had nowhere to put it, and typing markup into the
 * textarea would have arrived escaped (Chris, 2026-09-20: *"the content in
 * the MQL content reviews should be a WYSIWYG editor and push full html to
 * hubspot"*).
 *
 * So a body may now be **either**: the plain text an agent drafts, or the
 * HTML a reviewer composed. One field, not two, because two would be two
 * sources of truth for one thing and the pair would drift the first time
 * anything wrote only one of them. Which one it is, is answered by looking:
 * `isHtmlBody` is the single place that decides, and every reader goes
 * through the helpers here rather than testing for a `<` itself.
 *
 * The rules that fall out, and why:
 *
 * - **A model keeps writing plain text.** Asking one for HTML invites markup
 *   nobody asked for, and the voice contract validates prose. A redraft
 *   therefore replaces formatting, which is what a redraft is.
 * - **Linting reads the TEXT.** A banned phrase split by a tag
 *   (`<strong>game</strong> changer`) would walk straight through a regex
 *   over markup, and a tag name would trip one that matched nothing.
 * - **Nothing is trusted.** The HTML arrives over RPC and is rendered back to
 *   a person, so it is sanitized to this allowlist on the way in and again on
 *   the way out to HubSpot. A schema on the editor is a convenience, never
 *   the guarantee.
 */

import sanitize from 'sanitize-html';
import { EMAIL_TAGS, isHtmlBody, textToParagraphs } from './emailBodyShape';

export { EMAIL_TAGS, isHtmlBody, textToParagraphs };

const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: [...EMAIL_TAGS],
  // `href` only, and only schemes that resolve to something a recipient can
  // open. `sanitize-html` drops `javascript:` by default; naming the schemes
  // says so out loud rather than relying on that.
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // A link out of an email opens away from the client, and a target nobody
  // set is a target nobody has to maintain.
  transformTags: { b: 'strong', i: 'em' },
  disallowedTagsMode: 'discard',
};

/**
 * The body as safe HTML, whatever it arrived as.
 *
 * The one conversion at the boundary: HTML is sanitized to the allowlist,
 * prose is wrapped into paragraphs the way it always was. Both HubSpot sinks
 * (the nurture slot properties and the staged note) render HTML, so both call
 * this and neither decides for itself.
 * @param body - The stored body, text or HTML.
 */
export function emailBodyHtml(body: string): string {
  if (!isHtmlBody(body)) {
    return textToParagraphs(body);
  }
  return sanitize(body, SANITIZE_OPTIONS).trim();
}

/**
 * The body as plain text, whatever it arrived as: what the voice rules read,
 * and what a plain-text fallback sends.
 *
 * Block boundaries become blank lines and `<br>` a single newline, so the
 * shape of the message survives the round trip and a lint message can still
 * quote a recognisable span.
 * @param body - The stored body, text or HTML.
 */
export function emailBodyText(body: string): string {
  if (!isHtmlBody(body)) {
    return body;
  }
  const withBreaks = sanitize(body, SANITIZE_OPTIONS)
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/(p|li)>/gi, '\n\n')
    .replaceAll(/<li\b[^>]*>/gi, '• ');
  return decodeEntities(sanitize(withBreaks, { allowedTags: [], allowedAttributes: {} }))
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The handful of entities `textToParagraphs` and the editor produce.
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
