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
