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
 * Every line is its own paragraph. A drafted email is short prose, and a
 * single newline in it is a paragraph the model meant: "Irene,\nWhere would
 * you say..." went out on 2026-10-16 with the greeting glued to the first
 * sentence by a `<br>`. Blank lines separate the same way, Windows line
 * endings included.
 *
 * The small markdown a model still writes is rendered, never sent literally:
 * `- item` / `* item` / `1. item` lines become lists, `**bold**` and `*em*`
 * become marks, `[text](url)` and bare URLs become links (a bare URL is not
 * a link in HubSpot, so it was neither clickable from every client nor
 * tracked). The escaping is what stops a drafted `<` becoming markup.
 * @param text - Plain text.
 */
export function textToParagraphs(text: string): string {
  const lines = text.replaceAll(/\r\n?/g, '\n').split('\n').map(l => l.trim());
  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`);
      list = null;
    }
  };
  lines.forEach((line, i) => {
    if (!line) {
      flush();
      return;
    }
    const bullet = /^[-*•]\s+(\S.*)$/.exec(line);
    // A numbered line is a list item only beside another one: "2026 was..." is not a list.
    const numbered = /^\d+[.)]\s+(\S.*)$/.exec(line);
    const numberedRun = numbered && [lines[i - 1], lines[i + 1]].some(l => l && /^\d+[.)]\s+\S/.test(l));
    const item = bullet ? { tag: 'ul' as const, text: bullet[1]! } : numberedRun ? { tag: 'ol' as const, text: numbered[1]! } : null;
    if (item) {
      if (list?.tag !== item.tag) {
        flush();
        list = { tag: item.tag, items: [] };
      }
      list!.items.push(inlineMarks(item.text));
      return;
    }
    flush();
    out.push(`<p>${inlineMarks(line)}</p>`);
  });
  flush();
  return out.join('');
}

/** A bare http(s) URL, ending before trailing punctuation. */
const BARE_URL = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]']/g;

/**
 * One line of prose → escaped text with links and marks.
 * @param line - Unescaped plain text.
 */
function inlineMarks(line: string): string {
  const escaped = escapeText(line);
  // Links first, parked behind placeholders, so neither the bare-URL pass nor
  // the emphasis pass reaches inside an href.
  const links: string[] = [];
  const park = (html: string) => `\u0000${links.push(html) - 1}\u0000`;
  let s = escaped.replaceAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, href: string) => park(`<a href="${href}">${label}</a>`));
  s = s.replaceAll(BARE_URL, url => park(`<a href="${url}">${url}</a>`));
  s = s
    .replaceAll(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '<strong>$1</strong>')
    .replaceAll(/(^|[^*\w])\*(\S(?:[^*]*\S)?)\*\B/g, '$1<em>$2</em>');
  return s.replaceAll(/\0(\d+)\0/g, (_, n: string) => links[Number(n)]!);
}

/**
 * Bare URLs in a fragment of HTML → links, leaving existing links and tags alone.
 * @param html - Sanitized email HTML.
 */
export function linkifyHtml(html: string): string {
  return html
    .split(/(<a\b[\s\S]*?<\/a>|<[^>]+>)/i)
    .map(part => (part.startsWith('<') ? part : part.replaceAll(BARE_URL, url => `<a href="${url}">${url}</a>`)))
    .join('');
}

/**
 * @param s - Plain text.
 */
function escapeText(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
