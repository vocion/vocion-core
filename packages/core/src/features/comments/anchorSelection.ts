/**
 * Turning a DOM selection into a content anchor, and back into a highlight.
 *
 * The bridge between what the reviewer did (dragged across words on screen)
 * and what we store (a quote plus its surrounding text). Kept apart from the
 * components so the offset arithmetic is testable without a browser.
 */

/**
 * The character offset of a (node, offset) point within a container's text,
 * counting only text nodes — the same order `textContent` produces.
 * @param container - The element whose text defines the offset space.
 * @param node - The selection boundary's node.
 * @param offset - The boundary's offset within that node.
 * @returns The offset within the container's full text.
 */
export function offsetWithin(container: Node, node: Node, offset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) {
      return total + offset;
    }
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

/**
 * Wrap a character range inside a container in `<mark>` elements, without
 * changing the text. Ranges that span several text nodes get one mark per
 * node, so a highlight can cross inline markup.
 * @param container - The element holding the text.
 * @param start - Range start, in container text offsets.
 * @param end - Range end, in container text offsets.
 * @param attrs - Attributes to set on each mark (class, data-*).
 * @returns The marks created, in document order.
 */
export function markRange(
  container: HTMLElement,
  start: number,
  end: number,
  attrs: Record<string, string>,
): HTMLElement[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const marks: HTMLElement[] = [];
  const pending: Array<{ node: Text; from: number; to: number }> = [];
  let seen = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    const nodeStart = seen;
    const nodeEnd = seen + len;
    if (nodeEnd > start && nodeStart < end) {
      pending.push({
        node,
        from: Math.max(0, start - nodeStart),
        to: Math.min(len, end - nodeStart),
      });
    }
    seen = nodeEnd;
    node = walker.nextNode() as Text | null;
  }
  // Split after collecting: splitting while walking invalidates the walker.
  for (const { node: text, from, to } of pending) {
    if (to <= from) {
      continue;
    }
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, to);
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) {
      mark.setAttribute(k, v);
    }
    try {
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
      marks.push(mark);
    } catch {
      /* a range that cannot be surrounded is skipped rather than corrupting the DOM */
    }
  }
  return marks;
}

/**
 * Remove marks matching a selector, restoring the original text nodes.
 * @param container
 * @param selector
 */
export function clearMarks(container: HTMLElement, selector: string): void {
  container.querySelectorAll<HTMLElement>(selector).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}
