/**
 * A page's markdown as WEBFLOW RICH TEXT: the HTML a CMS item's RichText field
 * takes through the Data API. Pure.
 *
 * Webflow's rich text holds headings, paragraphs, lists, block quotes, links,
 * bold and italic, code, and images as figures; Webflow fetches an image from
 * its URL and hosts it. It has no tables and no rules, so a table becomes a
 * list of its rows and a rule is left out, each said in `notes` so the
 * publish card shows what changed. A `#` heading in the body becomes an h2:
 * the post's title is the page's one h1. Anything the draft wrote as raw HTML
 * is escaped, never passed through.
 */

/** What the conversion made: the HTML, the images it points at, and what it changed. */
export type WebflowRichText = { html: string; images: string[]; notes: string[] };

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A link target the site may carry: http(s), mailto, or a path on the site itself.
 * @param href - The markdown link's target.
 */
function linkHref(href: string): string | null {
  const h = href.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(h) || /^\/(?!\/)/.test(h) || h.startsWith('#') ? h : null;
}

/**
 * An image Webflow can fetch: an http(s) URL.
 * @param src - The markdown image's target.
 */
function imageSrc(src: string): string | null {
  const s = src.trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

/** `![alt](url "caption")`, in a line. */
const IMAGE_RE = /!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"([^"]*)")?\s*\)/g;

/**
 * Inline markdown on escaped text: code, bold, italic, links. Code spans are
 * kept aside first, so nothing inside them is read as markup.
 * @param raw - The line, unescaped.
 */
function inline(raw: string): string {
  const codes: string[] = [];
  let out = escapeHtml(raw).replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\s*\)/g, (_m, text: string, href: string) => {
    const ok = linkHref(href.replace(/&amp;/g, '&'));
    return ok ? `<a href="${escapeHtml(ok)}">${text}</a>` : text;
  });
  out = out.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a?: string, b?: string) => `<strong>${a ?? b}</strong>`);
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\n]+)_\b/g, '$1<em>$2</em>');
  return out.replace(/\0(\d+)\0/g, (_m, i: string) => codes[Number(i)]!);
}

/**
 * A figure for one image, the way Webflow's own editor writes it.
 * @param src - The image URL.
 * @param alt - Its alt text.
 * @param caption - Its caption, when the draft gave one.
 */
function figure(src: string, alt: string, caption?: string): string {
  return `<figure class="w-richtext-figure-type-image w-richtext-align-fullwidth"><div><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></div>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

const isRule = (line: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const isTableSep = (line: string) => line.includes('-') && splitRow(line).every(c => /^:?-{3,}:?$/.test(c));
const listItem = (line: string) => /^\s*(?:([-*+])|(\d+)[.)])\s+(\S.*)$/.exec(line);

/**
 * Markdown to Webflow rich text.
 * @param markdown - The page's body, its title already taken off.
 */
export function markdownToWebflowRichText(markdown: string): WebflowRichText {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const images: string[] = [];
  const notes = new Set<string>();
  const para: string[] = [];

  // Images pulled out of a line become figures after it; the rest is the line's text.
  const takeImages = (line: string): { text: string; figures: string[] } => {
    const figures: string[] = [];
    const text = line.replace(IMAGE_RE, (_m, alt: string, src: string, caption?: string) => {
      const ok = imageSrc(src);
      if (!ok) {
        notes.add(`An image that is not an http(s) URL (${src.slice(0, 80)}) was left out: Webflow fetches images by URL.`);
        return '';
      }
      images.push(ok);
      figures.push(figure(ok, alt, caption));
      return '';
    });
    return { text: text.trim(), figures };
  };
  const flush = () => {
    if (para.length === 0) {
      return;
    }
    const { text, figures } = takeImages(para.join(' '));
    para.length = 0;
    if (text) {
      out.push(`<p>${inline(text)}</p>`);
    }
    out.push(...figures);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (t === '') {
      flush();
      i += 1;
      continue;
    }
    if (/^(?:```|~~~)/.test(t)) {
      flush();
      const fence = t.slice(0, 3);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence)) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(\S.*)$/.exec(t);
    if (h) {
      flush();
      const level = Math.max(2, h[1]!.length);
      if (h[1]!.length === 1) {
        notes.add('A # heading in the body became an h2: the post\'s title is its one h1.');
      }
      out.push(`<h${level}>${inline(h[2]!.replace(/\s#+$/, '').trim())}</h${level}>`);
      i += 1;
      continue;
    }
    if (isRule(t)) {
      flush();
      notes.add('A horizontal rule was left out: Webflow\'s rich text has none.');
      i += 1;
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      flush();
      const head = splitRow(t);
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = splitRow(lines[i]!);
        rows.push(`<li>${cells.map((c, n) => (head[n] ? `<strong>${inline(head[n]!)}:</strong> ${inline(c)}` : inline(c))).join('; ')}</li>`);
        i += 1;
      }
      out.push(`<ul>${rows.join('')}</ul>`);
      notes.add('A table became a list of its rows: Webflow\'s rich text has no tables.');
      continue;
    }
    const first = listItem(line);
    if (first) {
      flush();
      const ordered = Boolean(first[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = listItem(lines[i]!);
        if (m && Boolean(m[2]) === ordered) {
          items.push(m[3]!);
          i += 1;
        } else if (lines[i]!.trim() !== '' && /^\s{2,}\S/.test(lines[i]!) && items.length > 0 && !m) {
          items[items.length - 1] = `${items[items.length - 1]} ${lines[i]!.trim()}`;
          i += 1;
        } else {
          break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      const moved: string[] = [];
      out.push(`<${tag}>${items.map((it) => {
        const { text, figures } = takeImages(it);
        moved.push(...figures);
        return `<li>${inline(text)}</li>`;
      }).join('')}</${tag}>`);
      if (moved.length > 0) {
        notes.add('An image inside a list item was moved after the list: Webflow puts images between blocks.');
        out.push(...moved);
      }
      continue;
    }
    if (t.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }
    // An image alone on its line is its own figure, never inside a paragraph.
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(t)) {
      flush();
      out.push(...takeImages(t).figures);
      i += 1;
      continue;
    }
    para.push(t);
    i += 1;
  }
  flush();
  return { html: out.join('\n'), images, notes: [...notes] };
}

/**
 * The first image a draft shows, by URL: the post's main image when the page
 * names none of its own.
 * @param markdown - The draft.
 */
export function firstImageOf(markdown: string): { url: string; alt: string } | null {
  for (const m of markdown.matchAll(IMAGE_RE)) {
    const ok = imageSrc(m[2]!);
    if (ok) {
      return { url: ok, alt: m[1] ?? '' };
    }
  }
  return null;
}
