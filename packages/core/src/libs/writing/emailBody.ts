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
import { EMAIL_TAGS, isHtmlBody, linkifyHtml, textToParagraphs } from './emailBodyShape';

// Re-exported so callers have one import for "what is an email body";
// `emailBodyText` lives in the shape module because the voice rules read it
// and the workspace applier loads those on an older Node than `sanitize-html`
// supports.
export { EMAIL_TAGS, emailBodyText, isHtmlBody, textToParagraphs } from './emailBodyShape';

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

/** HubSpot's own paragraph: what its composer writes and its views render the same everywhere. */
const HS_P = '<p style="margin:0;">';
/** HubSpot's own blank line between paragraphs. */
const HS_SPACER = '<p style="margin:0;"><br></p>';

/**
 * The body as the HTML a HubSpot sequence token should hold.
 *
 * `emailBodyHtml` is semantic HTML: bare `<p>` that leans on default
 * margins. HubSpot's own templates write every paragraph as
 * `<p style="margin:0;">` with an explicit `<br>` paragraph between them, and
 * its views and several clients zero paragraph margins, so a body that
 * leaned on them arrived as one block. Reps saw exactly that (2026-10-16:
 * `<p>Dawn,<br><br>A mid-size...<br></p>`, greetings glued to the first line
 * by a single `<br>`). This writes HubSpot's shape:
 *
 * - every line break inside a paragraph becomes a paragraph of its own;
 * - empty paragraphs (an editor's blank line, a trailing `<br>`) are dropped,
 *   because the spacer already carries the gap;
 * - a list item's inner `<p>` (the editor's shape) is unwrapped;
 * - bare URLs become links, so they are clickable and tracked;
 * - `rewriteHref`, when given, rewrites every link (UTMs, at Enroll).
 * @param body - The stored body, text or HTML.
 * @param opts
 * @param opts.rewriteHref - Maps each link's href; the identity when absent.
 */
export function hubspotEmailHtml(body: string, opts: { rewriteHref?: (href: string) => string } = {}): string {
  const html = linkifyHtml(emailBodyHtml(body));
  const blocks: string[] = [];
  for (const block of topLevelBlocks(html)) {
    if (block.kind === 'list') {
      // The editor wraps each item's text in a <p>; an email list item is the text itself.
      const items = block.html
        .replaceAll(/<li>\s*<p>/gi, '<li>')
        .replaceAll(/<\/p>\s*<\/li>/gi, '</li>')
        .replaceAll(/<\/p>\s*<p>/gi, '<br>')
        .replaceAll(/<\/p>\s*(?=<(?:ul|ol)\b)/gi, '')
        .replaceAll(/<\/?p>/gi, '')
        .replaceAll(/<li>\s*(?:<br\s*\/?>\s*)*<\/li>/gi, '');
      if (/<li>/i.test(items)) {
        blocks.push(items.replaceAll(/<(ul|ol)>/gi, '<$1 style="margin:0;">'));
      }
      continue;
    }
    for (const part of block.html.split(/(?:<br\s*\/?>\s*)+/i)) {
      if (!isBlank(part)) {
        blocks.push(`${HS_P}${part.trim()}</p>`);
      }
    }
  }
  const out = blocks.join(HS_SPACER);
  const rewrite = opts.rewriteHref;
  return rewrite ? out.replaceAll(/<a href="([^"]*)">/g, (_, href: string) => `<a href="${rewrite(decodeAmp(href)).replaceAll('&', '&amp;')}">`) : out;
}

/**
 * @param s
 */
function decodeAmp(s: string): string {
  return s.replaceAll('&amp;', '&');
}

/**
 * Whether a fragment carries no words: tags, `&nbsp;` and whitespace only.
 * @param fragment
 */
function isBlank(fragment: string): boolean {
  return fragment.replaceAll(/<[^>]+>/g, '').replaceAll('&nbsp;', ' ').trim() === '';
}

/**
 * Sanitized email HTML split into its top-level blocks: each paragraph's
 * inner HTML, each list whole, and loose inline runs as paragraphs.
 * @param html - Output of `emailBodyHtml`: only the EMAIL_TAGS, no attributes but href.
 */
function topLevelBlocks(html: string): Array<{ kind: 'p' | 'list'; html: string }> {
  const blocks: Array<{ kind: 'p' | 'list'; html: string }> = [];
  const tag = /<(\/?)(p|ul|ol)\b[^>]*>/gi;
  let depth = 0;
  let open: { name: string; start: number; inner: number } | null = null;
  let loose = 0;
  for (const m of html.matchAll(tag)) {
    const [whole, closing, rawName] = m;
    const name = rawName!.toLowerCase();
    const at = m.index!;
    if (!closing) {
      if (depth === 0) {
        const run = html.slice(loose, at);
        if (!isBlank(run)) {
          blocks.push({ kind: 'p', html: run });
        }
        open = { name, start: at, inner: at + whole.length };
      }
      depth += name === 'p' && depth > 0 ? 0 : 1;
      continue;
    }
    if (name === 'p' && open?.name !== 'p') {
      continue;
    }
    depth = Math.max(0, depth - 1);
    if (depth === 0 && open) {
      const end = at + whole.length;
      blocks.push(open.name === 'p'
        ? { kind: 'p', html: html.slice(open.inner, at) }
        : { kind: 'list', html: html.slice(open.start, end) });
      open = null;
      loose = end;
    }
  }
  const tail = html.slice(loose);
  if (!isBlank(tail)) {
    blocks.push({ kind: 'p', html: tail });
  }
  return blocks;
}
