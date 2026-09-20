/**
 * The house framework, injected — so a document never ships a hand-written
 * copy of its own stylesheet.
 *
 * Every rendered document used to carry a `<style>` block the model typed
 * out from the skill's `framework.css`, and every one of them drifted: on a
 * live proposal (2026-09-19) fifteen classes from the skill's own component
 * vocabulary had no rule in the document that used them, and rendered as
 * bare `<div>`s. Telling the skill to copy more carefully is the weakest
 * lever there is (CLAUDE.md, *structural over prompting*), so the render
 * path puts the framework in instead: the model writes markup and its brand
 * tokens, and the CSS underneath is the file on disk.
 *
 * Two properties this has to keep, and both come from putting the CSS IN the
 * stored HTML rather than applying it at view time:
 *
 *   - a document is a self-contained artifact — it prints to PDF, it is
 *     downloaded, it is opened a year later with nothing to resolve against;
 *   - the workspace still owns its look — the CSS comes from the skill
 *     resource through `readByOrigin`, so a workspace that replaces the
 *     skill whole-file replaces the framework with it.
 *
 * The injected block goes FIRST, before whatever `<style>` the document
 * carries, so the document's own `:root` tokens and any deliberate override
 * win on the cascade. It is marked with a data attribute and removed again
 * before the model reads or edits the document, so `read_document` never
 * hands back 45 KB of framework and `replace_style` still means the author's
 * style block.
 */

/** Marks the block this module owns. Nothing else may use it. */
export const FRAMEWORK_ATTR = 'data-vocion-framework';

const BLOCK = new RegExp(`<style\\s[^>]*${FRAMEWORK_ATTR}[^>]*>[\\s\\S]*?<\\/style>\\s*`, 'gi');

/**
 * The document as its author wrote it: every injected block removed.
 *
 * Idempotent, and safe on HTML that never had one — which is what makes it
 * the first step of every re-injection, so a re-verify swaps a stale
 * framework for the current one instead of stacking two.
 * @param html - The document.
 */
export function stripFramework(html: string): string {
  return html.replace(BLOCK, '');
}

/**
 * Put the framework in, ahead of the document's own styles.
 *
 * Placement, in order of preference: before the first `<style>` the author
 * wrote (so their tokens override), else at the end of `<head>`, else at the
 * very top. A document with neither is not in the house framework at all,
 * and a leading block still applies.
 * @param html - The document as authored.
 * @param css - The stylesheet to inject.
 * @param source - The skill slug it came from, recorded on the tag.
 */
export function injectFramework(html: string, css: string, source: string): string {
  const stripped = stripFramework(html);
  if (!css.trim()) {
    return stripped;
  }
  // `</style>` inside the CSS would close the block early; it cannot appear
  // in valid CSS, and a document that contains one is not worth guessing at.
  const safe = css.replace(/<\/style/gi, '<\\/style');
  const block = `<style ${FRAMEWORK_ATTR}="${escapeAttr(source)}">\n${safe}\n</style>\n`;
  const firstStyle = /<style\b/i.exec(stripped);
  if (firstStyle) {
    return stripped.slice(0, firstStyle.index) + block + stripped.slice(firstStyle.index);
  }
  const headEnd = /<\/head\s*>/i.exec(stripped);
  if (headEnd) {
    return stripped.slice(0, headEnd.index) + block + stripped.slice(headEnd.index);
  }
  return block + stripped;
}

function escapeAttr(s: string): string {
  return s.replace(/[^\w.-]/g, '');
}
