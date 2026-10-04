/**
 * WHICH PART OF A LONG PAGE A SNAPSHOT SHOWS. The live browser's snapshot is
 * capped (`BROWSER_LIMITS.snapshotChars`), and a page longer than the cap used
 * to show only its top: on walk 22 (FE-226, 2026-10-04) the document page's
 * Expiry section fell past the cutoff, no ref could reach it, and QA recorded
 * "environment cannot show" for a thing that was on the page. With `find`,
 * the window is cut around the first line that carries those words instead,
 * so any section can be addressed by naming what is written on it.
 */

export type SnapshotWindow = { text: string; found: boolean };

/**
 * The part of the tree that fits in `room` characters: the top, or the part
 * around the first line containing `find` (case-insensitive). Each cut says
 * how much was left out on that side, so the reader knows the page goes on.
 * @param tree - The whole accessibility tree, one element per line.
 * @param room - Characters available.
 * @param find - Words on the section wanted, or nothing for the top.
 */
export function snapshotWindow(tree: string, room: number, find?: string | null): SnapshotWindow {
  if (tree.length <= room) {
    return { text: tree, found: find ? tree.toLowerCase().includes(find.toLowerCase()) : false };
  }
  const needle = find?.trim().toLowerCase() ?? '';
  const at = needle ? tree.toLowerCase().indexOf(needle) : -1;
  if (at < 0) {
    const head = tree.slice(0, room);
    return { text: `${head}\n[truncated: ${tree.length - room} more characters of the page were not shown${needle ? `; "${find!.trim()}" is not on this page` : ''}]`, found: false };
  }
  // The line the words sit on, then as much before it as after it.
  const lineStart = tree.lastIndexOf('\n', at) + 1;
  const half = Math.floor(room / 2);
  let from = Math.max(0, lineStart - half);
  let to = Math.min(tree.length, from + room);
  if (to - from < room) {
    from = Math.max(0, to - room);
  }
  // Cut on whole lines.
  if (from > 0) {
    from = tree.indexOf('\n', from) + 1;
  }
  if (to < tree.length) {
    to = tree.lastIndexOf('\n', to);
  }
  const before = from > 0 ? `[${from} characters above "${find!.trim()}" not shown]\n` : '';
  const after = to < tree.length ? `\n[${tree.length - to} characters below not shown]` : '';
  return { text: `${before}${tree.slice(from, to)}${after}`, found: true };
}
