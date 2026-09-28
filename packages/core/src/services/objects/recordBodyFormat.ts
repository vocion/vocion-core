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

/**
 * Whether records of this type carry a body artifact. Every type does: a
 * record is a noun that is edited, versioned, previewed and cited, so it is
 * an artifact (principle 7) — the request was first (#815), and every other
 * type followed (backlog 035). A type opts OUT with `x-record-body: false`
 * on its schema, for records that are machine bookkeeping nobody reads.
 * @param _slug - The object type slug (kept so callers need not change when a type is special-cased).
 * @param schema - Its JSON Schema.
 */
export function recordBodyEnabled(_slug: string, schema: Schema): boolean {
  const flag = (schema as Prop | null | undefined)?.['x-record-body'];
  return typeof flag === 'boolean' ? flag : true;
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
