import { stringify as toYaml } from 'yaml';
import { RESERVED_OBJECT_KEYS } from '@/libs/actions/objects-update-meta';
import { declaredRecordFields } from '@/libs/workspace/records';

/**
 * A record's body, as text — the pure half of `recordBody.ts` (backlog 035).
 *
 * A record's human text (the story, what counts as done, the notes) is a
 * markdown artifact, so it versions, previews and can be cited like every
 * other artifact. The type's schema decides what is body and what is
 * headmatter, with no list of keys here: a field the type reads as prose
 * (`x-display.role: prose`, or the named prose keys `records.ts` defaults to)
 * that is a string or a list of statements is a section of the body;
 * everything else the record carries is YAML headmatter above it.
 *
 * Nothing here touches the database, so every rule can be tested alone.
 */

/** The role the body artifact plays on its record (`artifact.recordRole`). */
export const RECORD_BODY_ROLE = 'body';

/** The artifact's own ceiling (`markdownSpecSchema.md`). */
const MD_LIMIT = 60_000;

type Prop = Record<string, unknown>;
type Schema = { properties?: Record<string, Prop>; [k: string]: unknown } | null | undefined;

/** Object types whose records get a body until a type says otherwise (spec §5: start with `request`). */
const DEFAULT_BODY_TYPES: ReadonlySet<string> = new Set(['request']);

/**
 * Whether records of this type carry a body artifact. `request` does by
 * default; any type opts in or out with `x-record-body` on its schema, so the
 * next type costs a line in its `type.yaml`, not a change here.
 * @param slug - The object type slug.
 * @param schema - Its JSON Schema.
 */
export function recordBodyEnabled(slug: string, schema: Schema): boolean {
  const flag = (schema as Prop | null | undefined)?.['x-record-body'];
  if (typeof flag === 'boolean') {
    return flag;
  }
  return DEFAULT_BODY_TYPES.has(slug.trim().toLowerCase());
}

function propsOf(schema: Schema): Record<string, Prop> {
  const p = schema?.properties;
  return p && typeof p === 'object' ? p : {};
}

/**
 * The key a statement object keeps its words under, when its items declare one.
 * @param prop - An array property's JSON Schema.
 */
function statementKeyOf(prop: Prop): 'statement' | 'text' | null {
  const items = prop.items as Prop | undefined;
  if (!items || items.type !== 'object') {
    return null;
  }
  const ip = (items.properties ?? {}) as Record<string, Prop>;
  if (ip.statement?.type === 'string') {
    return 'statement';
  }
  if (ip.text?.type === 'string') {
    return 'text';
  }
  return null;
}

export type BodyField = { key: string; label: string; shape: 'text' | 'list' | 'statements'; statementKey?: 'statement' | 'text' };

/**
 * The fields that make up the body, in the order the type reads them.
 * @param schema - The type's JSON Schema.
 */
export function bodyFields(schema: Schema): BodyField[] {
  const props = propsOf(schema);
  const out: BodyField[] = [];
  for (const f of declaredRecordFields(schema)) {
    const prop = props[f.key] ?? {};
    if (RESERVED_OBJECT_KEYS.has(f.key)) {
      continue;
    }
    const statementKey = prop.type === 'array' ? statementKeyOf(prop) : null;
    if (statementKey) {
      // A list of statements is what a person reads as a list — acceptance
      // criteria, steps — whatever the type called its role.
      out.push({ key: f.key, label: f.label ?? f.key, shape: 'statements', statementKey });
    } else if (f.role === 'prose' && prop.type === 'string') {
      out.push({ key: f.key, label: f.label ?? f.key, shape: 'text' });
    } else if (f.role === 'prose' && prop.type === 'array' && (prop.items as Prop | undefined)?.type === 'string') {
      out.push({ key: f.key, label: f.label ?? f.key, shape: 'list' });
    }
  }
  return out;
}

/**
 * Declared order of every field, for a stable headmatter and diff.
 * @param schema - The type's JSON Schema.
 */
function declaredOrder(schema: Schema): string[] {
  const shown = declaredRecordFields(schema).map(f => f.key);
  const all = Object.keys(propsOf(schema));
  return [...shown, ...all.filter(k => !shown.includes(k))];
}

/**
 * A field as a person reads its name.
 * @param schema - The type's JSON Schema.
 * @param key - The field.
 */
export function fieldLabel(schema: Schema, key: string): string {
  const prop = propsOf(schema)[key] ?? {};
  const d = (prop['x-display'] ?? {}) as Prop;
  if (typeof d.label === 'string') {
    return d.label;
  }
  if (typeof prop.title === 'string') {
    return prop.title;
  }
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The record's fields as the body holds them: every declared field it
 * carries, never the row's own columns, in declared order. Undeclared keys
 * (gate bookkeeping, a stray value) stay on the row: the body is what the
 * type says the record is.
 * @param meta - `business_object.metadata`.
 * @param schema - The type's JSON Schema.
 */
export function recordFields(meta: Record<string, unknown>, schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of declaredOrder(schema)) {
    if (RESERVED_OBJECT_KEYS.has(key)) {
      continue;
    }
    const v = meta[key];
    if (v !== undefined && v !== null) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Key-order-independent JSON: jsonb does not keep key order, so a plain
 * stringify would call every read-back a change.
 * @param value - Any JSON value.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  }) ?? 'undefined';
}

function statementLine(item: unknown, statementKey: 'statement' | 'text'): string | null {
  if (typeof item === 'string') {
    return item.trim() ? `- ${item.trim()}` : null;
  }
  if (!item || typeof item !== 'object') {
    return null;
  }
  const o = item as Record<string, unknown>;
  const words = typeof o[statementKey] === 'string' ? (o[statementKey] as string).trim() : '';
  if (!words) {
    return null;
  }
  const mark = typeof o.met === 'boolean' ? (o.met ? '[x] ' : '[ ] ') : typeof o.done === 'boolean' ? (o.done ? '[x] ' : '[ ] ') : '';
  return `- ${mark}${words.replace(/\s*\n\s*/g, ' ')}`;
}

/**
 * The body artifact's markdown: YAML headmatter of the record's facts, the
 * title, then one section per body field.
 * @param input - The record.
 * @param input.title - The record's title (the row's column).
 * @param input.schema - The type's JSON Schema.
 * @param input.fields - {@link recordFields} of the record.
 */
export function renderRecordBody(input: { title: string; schema: Schema; fields: Record<string, unknown> }): string {
  const body = bodyFields(input.schema);
  const bodyKeys = new Set(body.map(b => b.key));
  const head = Object.fromEntries(Object.entries(input.fields).filter(([k]) => !bodyKeys.has(k)));
  const parts: string[] = [];
  if (Object.keys(head).length > 0) {
    parts.push(`---\n${toYaml(head, { lineWidth: 0 }).trimEnd()}\n---`);
  }
  parts.push(`# ${input.title.trim() || 'Untitled'}`);
  for (const f of body) {
    const v = input.fields[f.key];
    if (v === undefined || v === null) {
      continue;
    }
    if (f.shape === 'text') {
      const text = String(v).trim();
      if (text) {
        parts.push(`## ${f.label}\n\n${text}`);
      }
      continue;
    }
    const lines = (Array.isArray(v) ? v : [])
      .map(item => statementLine(item, f.statementKey ?? 'statement'))
      .filter((l): l is string => l !== null);
    if (lines.length > 0) {
      parts.push(`## ${f.label}\n\n${lines.join('\n')}`);
    }
  }
  const md = `${parts.join('\n\n')}\n`;
  return md.length > MD_LIMIT ? `${md.slice(0, MD_LIMIT - 40)}\n\n…(cut to fit; the fields are whole)\n` : md;
}

export type FieldChange = { key: string; label: string; before: unknown; after: unknown };

/**
 * What changed between two snapshots, field by field, in declared order.
 * @param schema - The type's JSON Schema.
 * @param before - The earlier snapshot (empty for the first version).
 * @param after - The later one.
 * @param only - Limit to these keys.
 */
export function fieldDiff(schema: Schema, before: Record<string, unknown>, after: Record<string, unknown>, only?: readonly string[]): FieldChange[] {
  const order = declaredOrder(schema);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : Number.MAX_SAFE_INTEGER);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(k => !only || only.includes(k))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const out: FieldChange[] = [];
  for (const key of keys) {
    if (stableJson(before[key] ?? null) !== stableJson(after[key] ?? null)) {
      out.push({ key, label: fieldLabel(schema, key), before: before[key] ?? null, after: after[key] ?? null });
    }
  }
  return out;
}

/**
 * The `set` that puts `keys` back to what `target` said, given what the
 * record says now. A key the target did not carry is cleared; a key already
 * right is left out, so a restore writes only what it changes.
 * @param current - The record's fields now.
 * @param target - The version being restored.
 * @param keys - The fields to restore.
 */
export function restoreSet(current: Record<string, unknown>, target: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of [...new Set(keys)].sort()) {
    if (RESERVED_OBJECT_KEYS.has(key)) {
      continue;
    }
    const want = target[key] ?? null;
    if (stableJson(current[key] ?? null) !== stableJson(want)) {
      set[key] = want;
    }
  }
  return set;
}

/* ------------------------------------------------------------------ */
/* Change: the selected words, replaced                                */
/* ------------------------------------------------------------------ */

/**
 * The text as it reads on screen, with a map from each visible character
 * back to its index in the source. Markdown markers (`**`, backticks, a
 * link's `](url)`, a heading's `#`, a list's `- `) are not on screen, so a
 * selection never contains them; whitespace runs collapse to one space.
 * @param raw - The markdown source.
 */
function visibleText(raw: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  let lineStart = true;
  const push = (ch: string, at: number) => {
    const space = /\s/.test(ch);
    if (space && (text.length === 0 || text.endsWith(' '))) {
      return;
    }
    text += space ? ' ' : ch;
    map.push(at);
  };
  while (i < raw.length) {
    if (lineStart) {
      const marker = /^(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ x]\]\s+)?|\d+[.)]\s+)/.exec(raw.slice(i));
      lineStart = false;
      if (marker) {
        i += marker[0].length;
        continue;
      }
    }
    const ch = raw[i]!;
    if (ch === '\n') {
      push(' ', i);
      lineStart = true;
      i += 1;
      continue;
    }
    if (ch === '*' || ch === '`' || ch === '~') {
      i += 1;
      continue;
    }
    if (ch === '_' && !(/\w/.test(raw[i - 1] ?? '') && /\w/.test(raw[i + 1] ?? ''))) {
      i += 1;
      continue;
    }
    if (ch === '[') {
      i += 1;
      continue;
    }
    if (ch === ']' && raw[i + 1] === '(') {
      const close = raw.indexOf(')', i + 2);
      i = close === -1 ? i + 1 : close + 1;
      continue;
    }
    push(ch, i);
    i += 1;
  }
  return { text, map };
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * `raw` with the first occurrence of `quote` replaced — matched as written,
 * else as it reads on screen (markdown markers and line breaks ignored).
 * @param raw - The field's text.
 * @param quote - What the person selected.
 * @param replacement - What it should say instead.
 * @returns The new text, or null when the quote is not in it.
 */
export function replaceQuote(raw: string, quote: string, replacement: string): string | null {
  const q = quote.trim();
  if (!q) {
    return null;
  }
  const at = raw.indexOf(q);
  if (at !== -1) {
    return raw.slice(0, at) + replacement + raw.slice(at + q.length);
  }
  const { text, map } = visibleText(raw);
  const want = collapse(q.replace(/[*`~]/g, ''));
  const found = text.indexOf(want);
  if (found === -1 || want.length === 0) {
    return null;
  }
  let start = map[found]!;
  let end = map[found + want.length - 1]! + 1;
  // Take the markup that wraps the words with them, balanced: `**bold**`
  // selected as "bold" is replaced whole, but an opener whose closer lies
  // outside the selection stays, so the rest of the text keeps its markup.
  const EMPHASIS = /[*_~`]/;
  let k = 0;
  while (start - k - 1 >= 0 && end + k < raw.length && EMPHASIS.test(raw[start - k - 1]!) && raw[start - k - 1] === raw[end + k]) {
    k += 1;
  }
  start -= k;
  end += k;
  // A link's `[` goes with it when the link's `](url)` is inside the span or
  // right after it; then the tail goes too.
  if (raw[start - 1] === '[') {
    const tail = /^\]\([^)]*\)/.exec(raw.slice(end));
    if (tail) {
      start -= 1;
      end += tail[0].length;
    } else if (raw.slice(start, end).includes('](')) {
      start -= 1;
    }
  }
  return raw.slice(0, start) + replacement + raw.slice(end);
}

export type LocatedChange = { key: string; label: string; before: unknown; after: unknown };

/**
 * Which field the selected words belong to, and what it says once they are
 * replaced. The hinted field first (the region the selection was in), then
 * the body in reading order, then any other text field.
 * @param schema - The type's JSON Schema.
 * @param fields - The record's fields now.
 * @param quote - The selected words.
 * @param replacement - The new wording.
 * @param hint - A field key or label the page named for the region.
 */
export function locateChange(schema: Schema, fields: Record<string, unknown>, quote: string, replacement: string, hint?: string | null): LocatedChange | null {
  const body = bodyFields(schema);
  const props = propsOf(schema);
  const textKeys = declaredOrder(schema).filter(k => props[k]?.type === 'string' && !Array.isArray(props[k]?.enum) && typeof props[k]?.format !== 'string' && !RESERVED_OBJECT_KEYS.has(k));
  const hinted = hint
    ? [...body.map(b => b.key), ...textKeys].find(k => k === hint || fieldLabel(schema, k).toLowerCase() === hint.trim().toLowerCase())
    : undefined;
  const order = [...new Set([...(hinted ? [hinted] : []), ...body.map(b => b.key), ...textKeys])];
  for (const key of order) {
    const value = fields[key];
    const shape = body.find(b => b.key === key);
    if (typeof value === 'string') {
      const next = replaceQuote(value, quote, replacement);
      if (next !== null) {
        return { key, label: fieldLabel(schema, key), before: value, after: next };
      }
      continue;
    }
    if (Array.isArray(value) && shape && shape.shape !== 'text') {
      const sk = shape.statementKey ?? 'statement';
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const words = typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as Record<string, unknown>)[sk] === 'string' ? (item as Record<string, string>)[sk]! : null;
        if (words === null) {
          continue;
        }
        const next = replaceQuote(words, quote, replacement);
        if (next !== null) {
          const after = value.map((it, j) => (j !== i ? it : typeof it === 'string' ? next : { ...(it as Record<string, unknown>), [sk]: next }));
          return { key, label: fieldLabel(schema, key), before: value, after };
        }
      }
    }
  }
  return null;
}
