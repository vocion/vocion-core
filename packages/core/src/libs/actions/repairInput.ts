/**
 * A CARD'S INPUT IS REPAIRED WHEN THE REPAIR IS CERTAIN, never guessed.
 *
 * Chat turns on 2026-09-29 ended with lines like "File factory filing bug —
 * not a card: its input does not fit ask.file: title: Invalid input: expected
 * string, received undefined" and "Notify requester of #232 — not a card:
 * steps.0.url: Invalid URL". Both are fixable without a model: the card's own
 * label is its title, and a workspace path is a URL once it has the app's
 * origin. This reads the action's schema issues and makes only those repairs
 * that have one right answer:
 *
 *   - a missing title-like string (`title`, `name`, `subject`, `summary`) →
 *     the card's label, less its leading verb ("File …");
 *   - a title-like string over its maximum → cut to fit;
 *   - a relative URL (`/w/…`) where a URL is required → absolute on the app's origin;
 *   - an enum value that matches one allowed value but for case or
 *     separators ("In Scope" → `in_scope`) → that value.
 *
 * Anything else stays wrong, and the caller drops the card. Pure.
 */

import type { z } from 'zod';

type Bag = Record<string, unknown>;

/** The string fields a card's label can stand in for. */
const TITLE_KEYS = new Set(['title', 'name', 'subject', 'summary']);

/**
 * A title from a card's label: the verb the button starts with is the card's,
 * not the record's ("File the plan bug" files a record called "Plan bug").
 * @param label - The card's label.
 */
export function titleFromLabel(label: string): string {
  const bare = label
    .replace(/[*_`]/g, '')
    .replace(/^\s*(?:file|open|raise|log|create|add)\s+(?:(?:an?|the)\s+)?(?:(?:ask|request|bug|issue|item)\s*)?(?:[:—–-]\s*|as\s[\w\s]+[:—–-]\s*)?/i, '')
    .trim();
  const text = bare || label.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * The object holding the value at `path`, and the key it sits under.
 * @param root - The input.
 * @param path - A schema issue's path.
 */
function parentOf(root: Bag, path: readonly PropertyKey[]): { holder: Bag; key: string | number } | null {
  if (path.length === 0) {
    return null;
  }
  let cur: unknown = root;
  for (const k of path.slice(0, -1)) {
    if (cur === null || typeof cur !== 'object') {
      return null;
    }
    cur = (cur as Bag)[k as string];
  }
  const key = path[path.length - 1]!;
  return cur !== null && typeof cur === 'object' && typeof key !== 'symbol' ? { holder: cur as Bag, key: key as string | number } : null;
}

/**
 * Repair what can be repaired with certainty.
 * @param schema - The action's input schema.
 * @param input - The card's input.
 * @param opts - What the repairs draw on.
 * @param opts.label - The card's label.
 * @param opts.baseUrl - The app's origin, for a relative URL.
 * @returns The input (a copy when anything changed) and one line per repair.
 */
export function repairActionInput(schema: z.ZodType, input: Bag, opts: { label: string; baseUrl: string }): { input: Bag; repaired: string[] } {
  let out: Bag = input;
  const repaired: string[] = [];
  // Two passes: filling a title can surface its maximum on the next parse.
  for (let pass = 0; pass < 2; pass += 1) {
    const parsed = schema.safeParse(out);
    if (parsed.success) {
      break;
    }
    const copy = structuredClone(out) as Bag;
    let changed = false;
    for (const issue of parsed.error.issues as Array<{ code: string; path: PropertyKey[]; expected?: string; format?: string; values?: unknown[]; maximum?: number | bigint; origin?: string }>) {
      const at = parentOf(copy, issue.path);
      if (!at) {
        continue;
      }
      const { holder, key } = at;
      const value = holder[key];
      const name = String(key);
      const where = issue.path.join('.');
      if (issue.code === 'invalid_type' && issue.expected === 'string' && value === undefined && TITLE_KEYS.has(name) && opts.label.trim()) {
        holder[key] = titleFromLabel(opts.label).slice(0, 200);
        repaired.push(`${where} from the card's label`);
        changed = true;
      } else if (issue.code === 'too_big' && issue.origin === 'string' && typeof value === 'string' && TITLE_KEYS.has(name) && typeof issue.maximum === 'number') {
        holder[key] = `${value.slice(0, Math.max(1, issue.maximum - 1)).trimEnd()}…`;
        repaired.push(`${where} cut to ${issue.maximum}`);
        changed = true;
      } else if (issue.code === 'invalid_format' && issue.format === 'url' && typeof value === 'string' && /^\/(?!\/)/.test(value.trim()) && /^https?:\/\//.test(opts.baseUrl)) {
        holder[key] = new URL(value.trim(), opts.baseUrl).toString();
        repaired.push(`${where} made absolute`);
        changed = true;
      } else if (issue.code === 'invalid_value' && typeof value === 'string' && Array.isArray(issue.values)) {
        const match = issue.values.filter(v => typeof v === 'string' && norm(v) === norm(value));
        if (match.length === 1) {
          holder[key] = match[0];
          repaired.push(`${where} "${value}" → "${String(match[0])}"`);
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
    out = copy;
  }
  return { input: out, repaired };
}
