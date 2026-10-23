/**
 * The break between two of the model's messages in one answer. The loop
 * streams each message's text straight after the last, so a turn that spoke,
 * called a tool and spoke again read "…from the wiki.Let me check…" as one
 * paragraph (seen live, 2026-10-23). A new message starts a new paragraph
 * unless the text already ends, or the new text starts, with whitespace.
 * The same rule is in `packages/agent-runtime/src/loop.ts`, which cannot
 * import core.
 * @param before - The answer so far.
 * @param next - The new message's first text.
 * @returns The separator to put between them: `''` or `'\n\n'`.
 */
export function messageBreak(before: string, next: string): string {
  if (!before || !next) {
    return '';
  }
  return /\s$/.test(before) || /^\s/.test(next) ? '' : '\n\n';
}
