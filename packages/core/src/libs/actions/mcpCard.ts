/**
 * How a proposed MCP write reads on its Review card.
 *
 * The card used to be the agent's whole summary as a four-line title and the
 * tool's raw JSON as the first thing on the page ("Exact arguments to
 * execute"), which is the engineer's view of a ledger change, not the
 * approver's (finance demo, 2026-10-20). A person approving a write wants:
 * what changes, from what to what, on which record, and in plain words what
 * pressing Approve does. The exact arguments stay one tab away.
 *
 * Pure: no database, no network.
 */

/** Argument keys that are plumbing, never shown in the change summary. */
const PLUMBING = new Set(['idempotency_key', 'idempotencyKey', 'expected_sync_token', 'expectedSyncToken', 'sync_token', 'syncToken']);

/** Longest title before it is cut at a word. */
const TITLE_MAX = 90;

/**
 * The first sentence of a summary, or the whole of it.
 * @param text
 */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /^(.+?[.!?])(?:\s+[A-Z(]|$)/.exec(t);
  return (m ? m[1]! : t).replace(/[.!?]$/, '').trim();
}

/**
 * A title short enough to read on one line: the first sentence, cut at a word.
 * @param summary
 */
export function shortTitle(summary: string): string {
  const s = firstSentence(summary);
  if (s.length <= TITLE_MAX) {
    return s;
  }
  const cut = s.slice(0, TITLE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,:;(\s]+$/, '')}…`;
}

/**
 * `expected_account_id` → `Expected account`.
 * @param key
 */
function humaniseKey(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\bid\b/i, '').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Account names the summary itself gives: "move from <A> to <B>".
 * @param summary
 */
function fromToNames(summary: string): { from?: string; to?: string } {
  // Plain string search, not one regex: a lazy group between two `\s+` runs
  // backtracks badly on a long summary.
  const sentence = firstSentence(summary);
  const lower = sentence.toLowerCase();
  const fromAt = lower.indexOf('from ');
  if (fromAt < 0) {
    return {};
  }
  const toAt = lower.indexOf(' to ', fromAt + 5);
  if (toAt < 0) {
    return {};
  }
  const from = sentence.slice(fromAt + 5, toAt).trim();
  const to = sentence.slice(toAt + 4).split(/[;—]/)[0]!.trim();
  return from && to ? { from, to } : {};
}

/**
 * `<name> (<id>)`, or whichever of the two exists.
 * @param name
 * @param id
 */
function named(name: string | undefined, id: unknown): string {
  const idText = id === undefined || id === null || id === '' ? '' : String(id);
  if (name && idText) {
    return `${name} (${idText})`;
  }
  return name ?? idText;
}

/** One row of the change, as a person reads it. */
export type ChangeRow = { label: string; value: string };

/**
 * What the write changes, row by row: a from → to pair where the arguments
 * carry one (`expected_X` / `to_X`), each other argument by name, plumbing left
 * out.
 * @param args - The tool's arguments.
 * @param summary - The agent's summary, read for the names it gives ids.
 */
export function changeRows(args: Record<string, unknown>, summary: string): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const names = fromToNames(summary);
  const used = new Set<string>();
  for (const key of Object.keys(args)) {
    const m = /^(?:expected|from|old)_(.+)$/.exec(key);
    if (!m) {
      continue;
    }
    const field = m[1]!;
    const toKey = [`to_${field}`, `new_${field}`].find(k => k in args);
    if (!toKey) {
      continue;
    }
    rows.push({ label: humaniseKey(field), value: `${named(names.from, args[key])} → ${named(names.to, args[toKey])}` });
    used.add(key);
    used.add(toKey);
  }
  for (const [key, value] of Object.entries(args)) {
    if (used.has(key) || PLUMBING.has(key) || value === null || value === undefined || typeof value === 'object') {
      continue;
    }
    rows.push({ label: humaniseKey(key), value: String(value) });
  }
  return rows;
}

/**
 * The approve verb, in what it does: a ledger write says so.
 * @param system - The source's name as a person knows it.
 * @param sourceSlug
 * @param tool
 */
export function approveVerb(system: string, sourceSlug: string, tool: string): string {
  if (/quickbooks|finance|ledger/i.test(`${system} ${sourceSlug} ${tool}`)) {
    return 'Approve and update QuickBooks';
  }
  return `Approve and run in ${system}`;
}
