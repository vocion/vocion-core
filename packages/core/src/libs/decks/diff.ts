/**
 * What changed between two versions of a deliverable, slide by slide (or
 * sheet by sheet).
 *
 * Read by a person or an agent who is about to redo their change: a stale
 * check-in is refused WITH this, so "Vocion changed slides 3 and 7 since you
 * checked it out" arrives with the words that changed. The import report
 * uses it too. Text, not markup — a restyled slide with the same words is
 * "restyled", not "rewritten".
 *
 * Pure.
 */

import type { DeckSpec } from '@/libs/cards/specs';
import { parseSheets, sheetLabel, textOf } from '@/libs/documents/sheets';
import { slideText } from './slides';

/** One comparable unit: a slide (keyed by id) or a sheet (keyed by position). */
export type DiffItem = { key: string; label: string; html: string; text: string; notes: string };

export type DeliverableDiff = {
  unit: 'slide' | 'sheet';
  added: Array<{ key: string; n: number; label: string }>;
  removed: Array<{ key: string; n: number; label: string }>;
  moved: Array<{ key: string; from: number; to: number; label: string }>;
  /** The words changed; `before`/`after` are short excerpts around the first difference. */
  textChanged: Array<{ key: string; n: number; label: string; before: string; after: string }>;
  notesChanged: Array<{ key: string; n: number; label: string }>;
  /** Same words, different markup — moved, resized or recoloured. */
  restyled: Array<{ key: string; n: number; label: string }>;
  titleChanged?: { before: string; after: string };
};

/**
 * The longest common subsequence of two key lists — the keys that kept their relative order.
 * @param a - Keys before.
 * @param b - Keys after.
 */
function lcs(a: string[], b: string[]): Set<string> {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keep.add(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return keep;
}

/**
 * Short excerpts of two strings around where they first differ.
 * @param a - Before.
 * @param b - After.
 */
export function excerpt(a: string, b: string): { before: string; after: string } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const from = Math.max(0, start - 30);
  const cut = (s: string, end: number) => `${from > 0 ? '…' : ''}${s.slice(from, Math.min(s.length, Math.max(end, start) + 30)).slice(0, 160)}${Math.max(end, start) + 30 < s.length ? '…' : ''}`;
  return { before: cut(a, endA), after: cut(b, endB) };
}

/**
 * Diff two ordered lists of items.
 * @param unit - What an item is called.
 * @param before - The older version.
 * @param after - The newer version.
 */
export function diffItems(unit: 'slide' | 'sheet', before: DiffItem[], after: DiffItem[]): DeliverableDiff {
  const b = new Map(before.map((it, i) => [it.key, { it, n: i + 1 }]));
  const a = new Map(after.map((it, i) => [it.key, { it, n: i + 1 }]));
  const common = before.map(x => x.key).filter(k => a.has(k));
  const kept = lcs(common, after.map(x => x.key).filter(k => b.has(k)));
  const out: DeliverableDiff = { unit, added: [], removed: [], moved: [], textChanged: [], notesChanged: [], restyled: [] };
  for (const [key, { it, n }] of b) {
    if (!a.has(key)) {
      out.removed.push({ key, n, label: it.label });
    }
  }
  for (const [key, { it, n }] of a) {
    const old = b.get(key);
    if (!old) {
      out.added.push({ key, n, label: it.label });
      continue;
    }
    if (!kept.has(key)) {
      out.moved.push({ key, from: old.n, to: n, label: it.label });
    }
    if (old.it.text !== it.text) {
      out.textChanged.push({ key, n, label: it.label, ...excerpt(old.it.text, it.text) });
    } else if (old.it.html !== it.html && old.it.notes === it.notes) {
      out.restyled.push({ key, n, label: it.label });
    }
    if (old.it.notes !== it.notes) {
      out.notesChanged.push({ key, n, label: it.label });
    }
  }
  return out;
}

/**
 * A deck as diff items.
 * @param spec - The deck.
 */
export function deckItems(spec: Pick<DeckSpec, 'order' | 'slides'>): DiffItem[] {
  return spec.order.map((id) => {
    const html = spec.slides[id] ?? '';
    const t = slideText(html);
    return { key: id, label: t.label, html, text: t.text, notes: t.notes };
  });
}

/**
 * Diff two deck versions.
 * @param before - The older deck.
 * @param after - The newer deck.
 */
export function diffDecks(before: Pick<DeckSpec, 'order' | 'slides' | 'title'>, after: Pick<DeckSpec, 'order' | 'slides' | 'title'>): DeliverableDiff {
  const d = diffItems('slide', deckItems(before), deckItems(after));
  return before.title !== after.title ? { ...d, titleChanged: { before: before.title, after: after.title } } : d;
}

/**
 * Diff two document versions sheet by sheet. Sheets carry no id, so they are
 * matched by position: an inserted sheet reads as later sheets changing,
 * which is still the honest list of pages whose words differ.
 * @param before - The older HTML.
 * @param after - The newer HTML.
 */
export function diffDocuments(before: string, after: string): DeliverableDiff {
  const items = (html: string): DiffItem[] => parseSheets(html).sheets.map(s => ({ key: String(s.n), label: sheetLabel(s.html), html: s.html, text: textOf(s.html), notes: '' }));
  const d = diffItems('sheet', items(before), items(after));
  const tb = parseSheets(before).title;
  const ta = parseSheets(after).title;
  return tb !== ta && tb && ta ? { ...d, titleChanged: { before: tb, after: ta } } : d;
}

/**
 * True when nothing a reader could see changed.
 * @param d - A diff.
 */
export function isEmptyDiff(d: DeliverableDiff): boolean {
  return !d.titleChanged && [d.added, d.removed, d.moved, d.textChanged, d.notesChanged, d.restyled].every(l => l.length === 0);
}

/**
 * The diff as lines a person reads: one per change, numbered by where it is now.
 * @param d - A diff.
 */
export function diffText(d: DeliverableDiff): string {
  if (isEmptyDiff(d)) {
    return 'No visible change.';
  }
  const U = d.unit === 'slide' ? 'Slide' : 'Sheet';
  const name = (n: number, key: string, label: string) => `${U} ${n}${d.unit === 'slide' ? ` [${key}]` : ''}${label ? ` (${label.slice(0, 60)})` : ''}`;
  const lines: string[] = [];
  if (d.titleChanged) {
    lines.push(`Title: "${d.titleChanged.before}" → "${d.titleChanged.after}"`);
  }
  for (const x of d.added) {
    lines.push(`+ ${name(x.n, x.key, x.label)} added`);
  }
  for (const x of d.removed) {
    lines.push(`- ${name(x.n, x.key, x.label)} removed`);
  }
  for (const x of d.moved) {
    lines.push(`↕ ${name(x.to, x.key, x.label)} moved from ${x.from}`);
  }
  for (const x of d.textChanged) {
    lines.push(`~ ${name(x.n, x.key, x.label)}: "${x.before}" → "${x.after}"`);
  }
  for (const x of d.notesChanged) {
    lines.push(`~ ${name(x.n, x.key, x.label)}: speaker notes changed`);
  }
  for (const x of d.restyled) {
    lines.push(`~ ${name(x.n, x.key, x.label)}: restyled, same words`);
  }
  return lines.join('\n');
}
