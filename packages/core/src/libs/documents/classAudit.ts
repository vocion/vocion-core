/**
 * The undefined-class audit — every class the markup uses that no rule in
 * the document's own stylesheet defines.
 *
 * A client document is a SELF-CONTAINED file: the markup and the CSS ship
 * together, print together, and are read months later with nothing to
 * resolve against. So a class with no rule is not a cosmetic slip — it is a
 * component that silently renders as a bare `<div>`, and it is invisible in
 * the HTML, invisible in the receipt, and obvious only to the client holding
 * the PDF.
 *
 * It happens because the model writes the `<style>` block by hand and the
 * block drifts from the framework it was copied from. Audited on a live
 * proposal (2026-09-19), fifteen classes from the skill's own component
 * vocabulary — `ovcards`, `ovc`, `ovh`, `ovb`, `oht`, `dtiles`, `dtile`,
 * `dv`, `dk`, `opts`, `opts-h`, `opt-row`, `opt-v`, `acc`, `dots` — were
 * used with no rule anywhere in that document. An agent looking at the same
 * document spent a turn concluding, wrongly, that the framework was missing
 * them. The framework had every one.
 *
 * Pure string work, like the rest of this module: the CSS is scanned for
 * SELECTOR text only (the prelude before each `{`), so a class name that
 * appears in a declaration value or a comment never counts as defined, and
 * a class used only inside an `@media` block does.
 */

/**
 * Every class name the markup uses, in first-seen order.
 *
 * Attribute values only — a class named inside a `<style>` or a `<script>`
 * is a rule or a string, not a use.
 * @param html - The document.
 */
export function usedClasses(html: string): string[] {
  const markup = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const out: string[] = [];
  const seen = new Set<string>();
  const attr = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (let m = attr.exec(markup); m; m = attr.exec(markup)) {
    for (const raw of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      const name = raw.trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Every class name any selector in the document's stylesheets mentions.
 *
 * Walks the CSS with a brace counter and keeps only the prelude of each
 * block — `.a .b > .c:hover` — so a class name that appears in a
 * declaration value or inside a comment is not mistaken for a definition.
 * @param html - The document.
 */
export function definedClasses(html: string): Set<string> {
  const out = new Set<string>();
  const style = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (let m = style.exec(html); m; m = style.exec(html)) {
    for (const name of classesInCss(m[1] ?? '')) {
      out.add(name);
    }
  }
  return out;
}

/**
 * The class names named by the selectors in one stylesheet.
 * @param css - The stylesheet text.
 */
export function classesInCss(css: string): Set<string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = new Set<string>();
  let prelude = '';
  for (const ch of text) {
    if (ch === '{') {
      // An at-rule prelude (`@media print`) holds no class names; a nested
      // rule inside one does, and arrives here on its own.
      if (!prelude.trimStart().startsWith('@')) {
        for (const m of prelude.matchAll(/\.(-?[_a-z][\w-]*)/gi)) {
          out.add(m[1]!);
        }
      }
      prelude = '';
    } else if (ch === '}') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return out;
}

/**
 * The classes used with no rule anywhere in the document, in the order the
 * markup first uses them.
 * @param html - The document as it will be stored and printed.
 */
export function undefinedClasses(html: string): string[] {
  const defined = definedClasses(html);
  return usedClasses(html).filter(c => !defined.has(c));
}
