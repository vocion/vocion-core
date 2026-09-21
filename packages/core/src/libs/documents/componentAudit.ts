/**
 * The per-sheet component audit — which sheets are a wall of text.
 *
 * A client document's house style is a component per sheet: a window, a step
 * strip, a Gantt, hairline rows. A sheet of nothing but paragraphs is the
 * failure that is hardest to see while writing it, because every paragraph on
 * it is good. It is obvious only to the client holding the PDF, and only as a
 * feeling — "this reads like a memo".
 *
 * Learned the same way the class audit was (2026-09-19/20): a real client
 * proposal came back a wall of text, and it took a person steering the writer
 * through chat, one instruction per sheet, to get a visual onto each one. The
 * instructions worked and then evaporated. This is the half of that a machine
 * can check without a model: HTML in, sheet numbers out.
 *
 * **It is a report, not a refusal.** The spine allows a sheet to be prose when
 * prose is right; the house rule (`visuals.md`) is that such a sheet says so
 * in one line of its own. So the receipt names the sheets and stops. The
 * judgement stays with the red team and the person.
 *
 * **The vocabulary is data, not TypeScript.** Core knows no class name. The
 * framework declares its own components in its own stylesheet —
 *
 *     .vocion-component-vocabulary { --components: journey gantt win2 …; }
 *
 * — and that block travels INSIDE the document, because the render path
 * injects the framework into every version it stores (`framework.ts`). So the
 * audit stays pure string work on one input, and a workspace that replaces
 * `framework.css` replaces the vocabulary with it, with no core change. A
 * document whose stylesheet declares nothing is audited against nothing and
 * reported as nothing: no finding is better than a wrong one.
 *
 * Why declared rather than derived from every selector in the file: `.body`,
 * `.foot`, `.strip`, `.lede` and `h2` are on every sheet, so "used a class the
 * framework defines" is true of a blank page. The distinction the audit needs
 * — block component vs page furniture vs inline ornament — is a judgement the
 * framework's author makes, so the framework's author writes it down.
 */

import { usedClasses } from './classAudit';
import { parseSheets } from './sheets';

/** The selector a framework declares its component vocabulary on. */
export const VOCABULARY_CLASS = 'vocion-component-vocabulary';

/** The custom property inside it that holds the list. */
export const VOCABULARY_PROPERTY = '--components';

export type ProseSheet = {
  /** 1-based position, as the footer prints it. */
  n: number;
  /** The sheet's `.strip .l` label or first heading; empty when it has neither. */
  label: string;
};

/**
 * The component vocabulary the document's own stylesheets declare.
 *
 * Empty when no stylesheet declares one — which is every document rendered
 * before a framework shipped the block, and every workspace whose framework
 * chooses not to. The caller reports nothing in that case.
 * @param html - The document as it will be stored and printed, framework included.
 */
export function declaredVocabulary(html: string): Set<string> {
  const out = new Set<string>();
  const style = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (let m = style.exec(html); m; m = style.exec(html)) {
    for (const name of vocabularyInCss(m[1] ?? '')) {
      out.add(name);
    }
  }
  return out;
}

/**
 * The component names one stylesheet declares.
 *
 * Walks the CSS with a brace counter, the way `classAudit.classesInCss` does,
 * and keeps only blocks whose prelude names {@link VOCABULARY_CLASS} — so the
 * list can never be read out of a comment, a declaration value, or some other
 * rule that happens to mention the property.
 * @param css - The stylesheet text.
 */
export function vocabularyInCss(css: string): Set<string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = new Set<string>();
  let prelude = '';
  let depth = 0;
  let body = '';
  for (const ch of text) {
    if (ch === '{') {
      depth++;
      if (depth === 1) {
        body = '';
      } else {
        body += ch;
      }
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        if (new RegExp(`\\.${VOCABULARY_CLASS}(?![\\w-])`).test(prelude)) {
          for (const name of namesInDeclaration(body)) {
            out.add(name);
          }
        }
        prelude = '';
        body = '';
      } else {
        body += ch;
      }
      continue;
    }
    if (depth === 0) {
      prelude += ch;
    } else {
      body += ch;
    }
  }
  return out;
}

/**
 * `--components: a b c;` → the names. Whitespace, commas and newlines all
 * separate, so the framework can lay the list out however it reads best.
 * @param body - The declaration block's text.
 */
function namesInDeclaration(body: string): string[] {
  const re = new RegExp(`${VOCABULARY_PROPERTY}\\s*:([^;}]*)`, 'i');
  const m = re.exec(body);
  if (!m) {
    return [];
  }
  return (m[1] ?? '')
    .split(/[\s,]+/)
    .map(s => s.trim().replace(/^\./, ''))
    .filter(s => /^-?[_a-z][\w-]*$/i.test(s));
}

/**
 * Every sheet that carries no component from the declared vocabulary, in
 * document order.
 *
 * Empty when the document declares no vocabulary, when it has no sheets, or
 * when every sheet carries something — all three are "nothing to report".
 * @param html - The document as it will be stored and printed.
 */
export function proseSheets(html: string): ProseSheet[] {
  const vocabulary = declaredVocabulary(html);
  if (vocabulary.size === 0) {
    return [];
  }
  const out: ProseSheet[] = [];
  for (const sheet of parseSheets(html).sheets) {
    const carries = usedClasses(sheet.html).some(c => vocabulary.has(c));
    if (!carries) {
      out.push({ n: sheet.n, label: sheet.label });
    }
  }
  return out;
}

/**
 * The receipt line, or null when there is nothing to say.
 *
 * Deliberately one sentence naming every sheet: the model cannot see which
 * sheets are prose by reading its own markup back, and the person reading the
 * receipt wants to know which pages to open.
 * @param sheets - What {@link proseSheets} found.
 * @param total - How many sheets the document has, for the proportion.
 */
export function proseSheetsNote(sheets: ReadonlyArray<ProseSheet>, total: number): string | null {
  if (sheets.length === 0) {
    return null;
  }
  const named = sheets.map(s => (s.label ? `${s.n} (${s.label})` : `${s.n}`)).join(', ');
  const plural = sheets.length === 1 ? 'sheet carries' : 'sheets carry';
  return `${sheets.length} of ${total} ${plural} no component from the framework's vocabulary: ${named}. Each is a wall of text unless its own prose says in one line why it needs no visual.`;
}
