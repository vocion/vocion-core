/**
 * WHAT A MARKDOWN BODY SHOWS, AND WHAT IT KEEPS FOR MACHINES.
 *
 * On 2026-10-29 a SERP brief opened in the artifact pane with its own
 * machine note at the top as words (`<!-- serp-brief {"query":…} -->`), and
 * its title twice: the pane's title, then the body's H1 saying the same.
 *
 *   - An HTML comment is a note for code (a brief's metadata, a synthesis
 *     marker), never text. react-markdown escapes raw HTML into text, so a
 *     comment is dropped from the tree before it gets there
 *     (`remarkDropHtmlComments`), in every renderer that uses it. Code blocks
 *     are untouched: a comment inside a fence is code.
 *   - A body that opens with an H1 equal to the title the pane already shows
 *     loses that H1 on that surface (`withoutTitleHeading`). The stored
 *     markdown keeps it: an export or a copy still reads whole.
 *
 * Pure and client-safe.
 */

/** The smallest shape of a markdown tree node this needs. */
type MdNode = { type: string; value?: string; children?: MdNode[] };

const COMMENT_ONLY = /^\s*(?:<!--[\s\S]*?-->\s*)+$/;

/**
 * Whether a raw HTML node is nothing but comments.
 * @param node - A tree node.
 */
function isCommentOnly(node: MdNode): boolean {
  return node.type === 'html' && typeof node.value === 'string' && COMMENT_ONLY.test(node.value);
}

/**
 * Drop every HTML comment from a markdown tree, at any depth.
 * @param node - The tree, or a branch of it.
 */
export function dropHtmlComments(node: MdNode): void {
  if (!node.children) {
    return;
  }
  node.children = node.children.filter(child => !isCommentOnly(child));
  for (const child of node.children) {
    dropHtmlComments(child);
  }
}

/** The remark plugin: HTML comments never render as text. */
export function remarkDropHtmlComments() {
  return (tree: MdNode) => {
    dropHtmlComments(tree);
  };
}

/**
 * Words compared as a reader compares them: case and spacing aside.
 * @param text - A heading or a title.
 */
function same(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The body without its opening H1 when that H1 says the title already shown
 * above it. Anything else is returned as it was.
 * @param md - The markdown.
 * @param title - The title the surface shows over it.
 */
export function withoutTitleHeading(md: string, title: string | null | undefined): string {
  if (!title?.trim()) {
    return md;
  }
  const lines = md.split('\n');
  const at = lines.findIndex(l => l.trim() !== '');
  const line = at >= 0 ? lines[at]!.trim() : '';
  if (!/^#\s/.test(line) || same(line.slice(1).replace(/#+$/, '')) !== same(title)) {
    return md;
  }
  return lines.slice(at + 1).join('\n').replace(/^\s*\n/, '');
}

/**
 * The spec as this surface draws it. In the pane, whose header already says
 * the artifact's title, a markdown body's opening H1 or card title that says
 * the same is not drawn a second time (2026-10-29: a SERP brief showed its
 * title twice). The stored markdown is unchanged.
 * @param artifact - The artifact.
 * @param artifact.kind
 * @param artifact.spec
 * @param artifact.title
 * @param surface - Where it is drawn.
 */
export function shownSpec(artifact: { kind: string; spec: Record<string, unknown>; title: string }, surface: 'chat' | 'artifact'): Record<string, unknown> {
  if (surface !== 'artifact' || artifact.kind !== 'markdown' || typeof artifact.spec.md !== 'string') {
    return artifact.spec;
  }
  const { title, ...rest } = artifact.spec as { title?: unknown; md: string };
  const sameTitle = typeof title === 'string' && title.trim().toLowerCase() === artifact.title.trim().toLowerCase();
  return { ...rest, ...(title !== undefined && !sameTitle ? { title } : {}), md: withoutTitleHeading(rest.md, artifact.title) };
}
