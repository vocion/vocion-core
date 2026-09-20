/**
 * The sheet model of a paginated HTML document — pure string work, no DOM.
 *
 * A document in the house framework is `<article class="sheet">` blocks in
 * order, each one US-Letter page, with everything else (head, styles, the
 * `⤓ PDF` button) around them. Editing by sheet is how the agent changes a
 * document without shipping 100 KB of HTML back and forth for "cut page 9":
 * it names the sheet, sends the new sheet, and the engine reassembles,
 * renumbers the footers and re-verifies.
 *
 * Kept free of a DOM library on purpose: the framework is regular, `article`
 * elements do not nest, and a regex split is transparent about what it does.
 */

export type Sheet = {
  /** 1-based position. */
  n: number;
  /** The whole `<article …>…</article>` element. */
  html: string;
  /** The `.strip .l` label, or the first heading, or empty. */
  label: string;
};

export type ParsedDocument = {
  /** Everything before the first sheet (doctype, head, body open, the PDF button). */
  before: string;
  sheets: Sheet[];
  /** Everything after the last sheet (closing tags, scripts). */
  after: string;
  /** The `<title>` text, or null. */
  title: string | null;
};

const SHEET_OPEN = /<(article|section)\s[^>]*class\s*=\s*"[^"]*\bsheet\b[^"]*"[^>]*>/g;

function decodeEntities(s: string): string {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&middot;', '·');
}

/**
 * Visible text of an HTML fragment, collapsed to one line.
 * @param fragment
 */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * The label a sheet is known by: the strip's left text (`<span class="l">`),
 * else its first h1/h2/h3, else empty.
 * @param sheetHtml
 */
export function sheetLabel(sheetHtml: string): string {
  const strip = /<span\s[^>]*class\s*=\s*"l"[^>]*>([\s\S]*?)<\/span>/.exec(sheetHtml);
  const fromStrip = strip ? textOf(strip[1]!) : '';
  if (fromStrip) {
    return fromStrip.slice(0, 120);
  }
  const heading = /<h[123]\b[^>]*>([\s\S]*?)<\/h[123]>/.exec(sheetHtml);
  return heading ? textOf(heading[1]!).slice(0, 120) : '';
}

/**
 * Split a document into its sheets. A document with no `.sheet` at all parses
 * to zero sheets with everything in `before` — the caller decides whether that
 * is an error (the render tools do; the inspector does not).
 * @param html
 */
export function parseSheets(html: string): ParsedDocument {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? textOf(titleMatch[1]!) || null : null;
  const sheets: Sheet[] = [];
  const opens: Array<{ index: number; tag: string; length: number }> = [];
  SHEET_OPEN.lastIndex = 0;
  for (let m = SHEET_OPEN.exec(html); m; m = SHEET_OPEN.exec(html)) {
    opens.push({ index: m.index, tag: m[1]!, length: m[0].length });
  }
  if (opens.length === 0) {
    return { before: html, sheets, after: '', title };
  }
  let cursor = 0;
  const before = html.slice(0, opens[0]!.index);
  for (let i = 0; i < opens.length; i++) {
    const open = opens[i]!;
    const closeTag = `</${open.tag}>`;
    const limit = i + 1 < opens.length ? opens[i + 1]!.index : html.length;
    let close = html.indexOf(closeTag, open.index + open.length);
    if (close === -1 || close > limit) {
      // Unclosed sheet: take everything up to the next sheet.
      close = limit;
      const chunk = html.slice(open.index, close);
      sheets.push({ n: i + 1, html: chunk, label: sheetLabel(chunk) });
      cursor = close;
      continue;
    }
    const end = close + closeTag.length;
    const chunk = html.slice(open.index, end);
    sheets.push({ n: i + 1, html: chunk, label: sheetLabel(chunk) });
    cursor = end;
  }
  return { before, sheets, after: html.slice(cursor), title };
}

/**
 * Put a document back together. Sheets are joined with a newline so the
 * source stays diffable; nothing else is touched.
 * @param doc
 */
export function assemble(doc: Pick<ParsedDocument, 'before' | 'after'> & { sheets: Array<Pick<Sheet, 'html'>> }): string {
  return `${doc.before}${doc.sheets.map(s => s.html).join('\n\n')}${doc.after}`;
}

/**
 * Rewrite every footer page number (`<div class="pnum">7 / 13</div>`) to its
 * position in document order. The house rule is "renumber programmatically,
 * never by hand", because a hand-numbered footer is wrong the moment a page
 * is cut or inserted — this is the programme.
 * @param sheets
 */
export function renumber(sheets: Sheet[]): Sheet[] {
  const total = sheets.length;
  return sheets.map((s, i) => ({
    ...s,
    n: i + 1,
    html: s.html.replace(
      /(<[^>]*\bclass\s*=\s*"[^"]*\bpnum\b[^"]*"[^>]*>)\s*\d+\s*(?:\/|of)\s*\d+\s*(<)/g,
      `$1${i + 1} / ${total}$2`,
    ),
  }));
}

export type DocumentOutline = {
  title: string | null;
  sheetCount: number;
  sheets: Array<{ n: number; label: string; chars: number }>;
  /** `src=` / `href=` values that are neither data: nor http(s): — a relative path the sandboxed render cannot resolve. */
  relativeAssets: string[];
  bytes: number;
};

/**
 * What a document IS, in a few hundred bytes: the model reads this instead of
 * the HTML, and the pane header prints from it.
 * @param html
 */
export function inspectDocument(html: string): DocumentOutline {
  const parsed = parseSheets(html);
  const relativeAssets: string[] = [];
  const attr = /\b(?:src|href)\s*=\s*"([^"]+)"/g;
  for (let m = attr.exec(html); m; m = attr.exec(html)) {
    const v = m[1]!.trim();
    if (!v || v.startsWith('#') || /^(?:data|https?|mailto|tel|blob|javascript):/i.test(v)) {
      continue;
    }
    if (!relativeAssets.includes(v) && relativeAssets.length < 20) {
      relativeAssets.push(v);
    }
  }
  return {
    title: parsed.title,
    sheetCount: parsed.sheets.length,
    sheets: parsed.sheets.map(s => ({ n: s.n, label: s.label, chars: s.html.length })),
    relativeAssets,
    bytes: html.length,
  };
}

/**
 * The outline as the model should read it — one line per sheet.
 * @param outline
 */
export function outlineText(outline: DocumentOutline): string {
  const lines = [
    `${outline.title ?? '(untitled)'} · ${outline.sheetCount} ${outline.sheetCount === 1 ? 'sheet' : 'sheets'} · ${Math.round(outline.bytes / 1024)} KB`,
    ...outline.sheets.map(s => `  ${s.n}. ${s.label || '(no label)'}`),
  ];
  if (outline.relativeAssets.length > 0) {
    lines.push(`  unresolved assets (relative paths, will not render): ${outline.relativeAssets.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * The document is the client's page; the app's chrome belongs to the app.
 *
 * The house framework told the model not to draw a `⤓ PDF` button, and the
 * model drew one anyway — `<div class="actions"><a href="#"
 * onclick="window.print()">⤓ PDF</a></div>`, floating over the first sheet on
 * every surface that renders the document. On 2026-09-18 an agent then
 * hand-patched a MALFORMED version of it (an anchor inside an anchor), which
 * is the tell that asking again is the wrong lever: a required behaviour that
 * the prompt cannot guarantee is enforced in code (CLAUDE.md, *structural over
 * prompting*).
 *
 * So the print affordance is removed deterministically on the way in and on
 * the way out: the engine strips it before it verifies and before it stores,
 * the served `document.html` strips it for rows written before this existed,
 * and the pane strips it again before the srcdoc. Printing is the app's verb —
 * it lives in the artifact header beside the PDF the renderer already made.
 *
 * Pure string work, like the rest of this module: `article` elements do not
 * nest and neither does a button bar, so depth-counted slicing is transparent
 * about what it removes — including the nested-anchor variant, which no
 * regex-in-one-pass survives.
 * @param html - The document as authored or stored.
 */
/** A wrapper whose whole job is a bar of controls over the document. */
const CHROME_WRAPPER = /<(div|nav|section|aside|header|footer|p)\s[^>]*class\s*=\s*"[^"]*\b(?:actions|no-print|noprint|print-bar|printbar|toolbar)\b[^"]*"[^>]*>/gi;
/** A control that prints, wrapped or bare. */
const PRINT_CONTROL = /<(a|button)\b[^>]*>/gi;
/** `window.print(` or the house download glyph — either makes it the app's chrome. */
const PRINT_MARKER = /window\s*\.\s*print\s*\(|⤓/;

export function stripDocumentChrome(html: string): string {
  let out = removeElements(html, CHROME_WRAPPER, isPrintChrome);
  out = removeElements(out, PRINT_CONTROL, isPrintControl);
  // An `onclick` that survived on an element worth keeping (a real link that
  // also printed): drop the handler, keep the link.
  out = out.replace(/\son\w+\s*=\s*"[^"]*window\s*\.\s*print\s*\([^"]*"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'[^']*window\s*\.\s*print\s*\([^']*'/gi, '');
  return out;
}

function isPrintChrome(element: string): boolean {
  return PRINT_MARKER.test(element);
}

/**
 * A bare control is the app's chrome when it prints AND it goes nowhere — a
 * `#` / `javascript:` href, or none — or when it wears the download glyph. A
 * real link in the client's prose that happens to carry a print handler keeps
 * its href and loses the handler instead: the words are the client's.
 * @param element
 */
function isPrintControl(element: string): boolean {
  if (!PRINT_MARKER.test(element)) {
    return false;
  }
  if (element.includes('⤓')) {
    return true;
  }
  const href = /\shref\s*=\s*"([^"]*)"/i.exec(element)?.[1]?.trim() ?? '';
  return href === '' || href === '#' || /^javascript:/i.test(href);
}

/**
 * Index just past the close tag that matches the open tag at `openIndex`,
 * counting nested opens of the same name; null when it is never closed.
 * @param html
 * @param tag
 * @param openIndex
 * @param openLength
 */
function elementEnd(html: string, tag: string, openIndex: number, openLength: number): number | null {
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = openIndex + openLength;
  for (let guard = 0; guard < 10_000; guard++) {
    close.lastIndex = cursor;
    const c = close.exec(html);
    if (!c) {
      return null;
    }
    open.lastIndex = cursor;
    for (let o = open.exec(html); o && o.index < c.index; o = open.exec(html)) {
      depth++;
      open.lastIndex = o.index + 1;
    }
    depth--;
    cursor = c.index + c[0].length;
    if (depth === 0) {
      return cursor;
    }
  }
  return null;
}

/**
 * Drop every element whose start tag matches `startTag` and whose whole
 * source satisfies `remove`. An element that is never closed is left alone —
 * removing to the end of the file would be worse than the button.
 * @param html
 * @param startTag
 * @param remove
 */
function removeElements(html: string, startTag: RegExp, remove: (element: string) => boolean): string {
  const re = new RegExp(startTag.source, startTag.flags.includes('g') ? startTag.flags : `${startTag.flags}g`);
  let out = '';
  let cursor = 0;
  re.lastIndex = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index < cursor) {
      re.lastIndex = cursor;
      continue;
    }
    const end = elementEnd(html, m[1]!.toLowerCase(), m.index, m[0].length);
    if (end === null || !remove(html.slice(m.index, end))) {
      continue;
    }
    out += html.slice(cursor, m.index);
    cursor = end;
    re.lastIndex = end;
  }
  return out + html.slice(cursor);
}
