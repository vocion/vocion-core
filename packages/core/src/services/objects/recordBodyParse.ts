import { parse as fromYaml } from 'yaml';
import { RESERVED_OBJECT_KEYS } from '@/libs/actions/objects-update-meta';
import { bodyFields, stableJson } from './recordBodyFormat';

/**
 * A record's body, read back — the inverse of `renderRecordBody` (backlog 035).
 *
 * The body artifact is how an agent changes a record through the artifact
 * path: `read_artifact`, edit the markdown, `update_artifact`. This turns the
 * edited markdown into the record's fields again, so the change lands as an
 * `objects.update_meta` write — the row, the version, trust and Undo — and
 * never as a version the row does not know about.
 *
 * Pure: no database, so every rule is tested alone.
 */

type Schema = Parameters<typeof bodyFields>[0];

export type ParsedRecordBody = {
  /** The record's fields once the edited body is read — current values kept where the body is silent. */
  fields: Record<string, unknown>;
  /** The `# heading`, when the body carries one. */
  title: string | null;
  /** Whether the body carried its headmatter, and so was the whole record. */
  whole: boolean;
};

const HEADMATTER = /^\uFEFF?---\n([\s\S]*?)\n---(?:\n|$)/;
const LIST_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[([ x])\][ \t]+)?(\S.*)?$/i;

type ListLine = { words: string; box: boolean | null };

/**
 * One list line, read back: its words, and its box when it had one.
 * @param line - A markdown line.
 */
function readListLine(line: string): ListLine | null {
  const m = LIST_LINE.exec(line);
  if (!m) {
    return null;
  }
  const words = (m[2] ?? '').trim();
  if (!words) {
    return null;
  }
  return { words, box: m[1] === undefined ? null : m[1].toLowerCase() === 'x' };
}

/**
 * A statements field from its section's lines. Each item keeps what the
 * record already knew about it (an id, a `met`) when its words match one, and
 * a reworded line in the same place keeps the fields of the line it replaced.
 * @param lines - The section's list lines, read.
 * @param current - The field's value now.
 * @param statementKey - Where an item keeps its words.
 */
function readStatements(lines: ListLine[], current: unknown, statementKey: 'statement' | 'text'): unknown[] {
  const before = Array.isArray(current) ? current : [];
  const wordsOf = (item: unknown): string | null => {
    if (typeof item === 'string') {
      return item.trim();
    }
    const w = item && typeof item === 'object' ? (item as Record<string, unknown>)[statementKey] : null;
    return typeof w === 'string' ? w.trim() : null;
  };
  const used = new Set<number>();
  const matched = lines.map(line => before.findIndex(item => wordsOf(item) === line.words));
  matched.forEach(at => at !== -1 && used.add(at));
  return lines.map((line, i) => {
    let at = matched[i]!;
    if (at === -1 && i < before.length && !used.has(i)) {
      at = i;
      used.add(i);
    }
    const prior = at === -1 ? undefined : before[at];
    if (typeof prior === 'string' && line.box === null) {
      return line.words;
    }
    const base: Record<string, unknown> = prior && typeof prior === 'object' ? { ...(prior as Record<string, unknown>) } : {};
    base[statementKey] = line.words;
    if (line.box !== null) {
      base[typeof base.done === 'boolean' && typeof base.met !== 'boolean' ? 'done' : 'met'] = line.box;
    }
    return base;
  });
}

/**
 * The fields an edited body says.
 *
 * Headmatter is YAML; each `## Section` is the body field its label (or key)
 * names. A body that carries its headmatter is the WHOLE record, so a section
 * it dropped is a field cleared. A body with no headmatter is the prose alone:
 * the facts, and any section it does not mention, stay as they are — an
 * agent that sends back only the section it changed changes only that.
 * @param md - The edited markdown.
 * @param schema - The type's JSON Schema.
 * @param current - `recordFields` of the record now.
 * @throws {Error} When the headmatter is not key: value YAML.
 */
export function parseRecordBody(md: string, schema: Schema, current: Record<string, unknown>): ParsedRecordBody {
  const text = md.replace(/\r\n/g, '\n');
  const head = HEADMATTER.exec(text);
  const whole = head !== null;
  const defs = bodyFields(schema);
  const bodyKeys = new Set(defs.map(b => b.key));
  const fields: Record<string, unknown> = {};

  if (head) {
    let parsed: unknown;
    try {
      parsed = fromYaml(head[1]!);
    } catch (err) {
      throw new Error(`The headmatter is not YAML (${(err as Error).message.split('\n')[0]}). Keep the block between the --- lines as key: value.`);
    }
    if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('The headmatter must be key: value pairs.');
    }
    for (const [k, v] of Object.entries((parsed ?? {}) as Record<string, unknown>)) {
      if (!bodyKeys.has(k) && v !== null && v !== undefined) {
        fields[k] = v;
      }
    }
  } else {
    for (const [k, v] of Object.entries(current)) {
      if (!bodyKeys.has(k)) {
        fields[k] = v;
      }
    }
  }

  const rest = head ? text.slice(head[0].length) : text;
  const titleLine = rest.split('\n').find(l => /^#\s+\S/.test(l));
  const sections = new Map<string, string>();
  for (const part of rest.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const label = (nl === -1 ? part : part.slice(0, nl)).trim().replace(/\s*#+$/, '').toLowerCase();
    const def = defs.find(b => b.label.toLowerCase() === label || b.key.toLowerCase() === label);
    if (def) {
      sections.set(def.key, nl === -1 ? '' : part.slice(nl + 1).trim());
    }
  }

  for (const def of defs) {
    const raw = sections.get(def.key);
    if (raw === undefined) {
      if (!whole && current[def.key] !== undefined) {
        fields[def.key] = current[def.key];
      }
      continue;
    }
    if (def.shape === 'text') {
      if (raw) {
        fields[def.key] = raw;
      }
      continue;
    }
    const lines = raw.split('\n').map(readListLine).filter((l): l is ListLine => l !== null);
    if (lines.length > 0) {
      fields[def.key] = def.shape === 'list' ? lines.map(l => l.words) : readStatements(lines, current[def.key], def.statementKey ?? 'statement');
    }
  }

  return { fields, title: titleLine ? titleLine.replace(/^#\s+/, '').replace(/\s+#+\s*$/, '').trim() : null, whole };
}

/**
 * The `set` that takes a record from `current` to `next`: every key whose
 * value differs, and a key `next` dropped written as null (cleared). The
 * row's own columns never appear.
 * @param current - The record's fields now.
 * @param next - The fields it should have.
 */
export function setBetween(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of [...new Set([...Object.keys(current), ...Object.keys(next)])].sort()) {
    if (RESERVED_OBJECT_KEYS.has(key)) {
      continue;
    }
    const want = next[key] ?? null;
    if (stableJson(current[key] ?? null) !== stableJson(want)) {
      set[key] = want;
    }
  }
  return set;
}
