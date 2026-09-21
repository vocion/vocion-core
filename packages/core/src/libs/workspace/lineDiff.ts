/**
 * A line diff small enough to sit on a review card: which lines a proposed
 * edit removes and which it adds, in order, with the unchanged run between
 * them folded. The card is where a person decides on an agent's change to a
 * mission or a playbook, so the diff is the content of the decision — not a
 * whole-file "before" and "after" the person would have to compare by eye.
 *
 * Longest common subsequence over lines. Files here are a few hundred lines
 * at most; anything past `MAX_LINES` falls back to a whole-file replacement
 * rather than a quadratic table.
 */

export type DiffLine = { op: ' ' | '-' | '+'; text: string };

const MAX_LINES = 4000;

/**
 * The line-level diff of two texts.
 * @param before
 * @param after
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.length === 0 ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after.length === 0 ? [] : after.replace(/\r\n/g, '\n').split('\n');
  if (a.length + b.length > MAX_LINES) {
    return [...a.map(text => ({ op: '-' as const, text })), ...b.map(text => ({ op: '+' as const, text }))];
  }
  // LCS table, then walk back.
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ op: '-', text: a[i]! });
      i++;
    } else {
      out.push({ op: '+', text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ op: '-', text: a[i++]! });
  }
  while (j < m) {
    out.push({ op: '+', text: b[j++]! });
  }
  return out;
}

/**
 * The diff as unified-style text with unchanged runs folded to `context`
 * lines either side of a change and a `…` marker where lines were skipped.
 * Empty when nothing changed.
 * @param before
 * @param after
 * @param opts
 * @param opts.context - Unchanged lines kept around each change (default 2).
 * @param opts.maxChars - Cap on the output; the tail is replaced by a note (default 4000).
 */
export function unifiedLineDiff(before: string, after: string, opts: { context?: number; maxChars?: number } = {}): string {
  const context = opts.context ?? 2;
  const maxChars = opts.maxChars ?? 4000;
  const lines = lineDiff(before, after);
  if (!lines.some(l => l.op !== ' ')) {
    return '';
  }
  const keep = new Set<number>();
  lines.forEach((l, idx) => {
    if (l.op !== ' ') {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        keep.add(k);
      }
    }
  });
  const out: string[] = [];
  let skipping = false;
  lines.forEach((l, idx) => {
    if (keep.has(idx)) {
      out.push(`${l.op} ${l.text}`);
      skipping = false;
    } else if (!skipping) {
      out.push('…');
      skipping = true;
    }
  });
  const text = out.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (diff truncated)` : text;
}

/**
 * How many lines a diff removes and adds — the one-line summary for a card.
 * @param before
 * @param after
 */
export function diffCounts(before: string, after: string): { removed: number; added: number } {
  const lines = lineDiff(before, after);
  return {
    removed: lines.filter(l => l.op === '-').length,
    added: lines.filter(l => l.op === '+').length,
  };
}
