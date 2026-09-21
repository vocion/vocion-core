import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { isEmptyValue, resolveField } from '@/libs/workspace/pageFields';

/**
 * A record read from its type's own declaration.
 *
 * The record page used to be one customer's discovery call in code: it read
 * `key_topics`, `next_steps`, `image_url` and five HubSpot keys, and every
 * object of every type got that page. An engineering task with a contract,
 * checks, a merged pull request and a cost showed none of it.
 *
 * The object type already says what a record carries — `type.yaml` →
 * `schema`, stored verbatim on `business_object_type.schema` — so this
 * turns that JSON Schema into the same {@link PageField} declarations the
 * list archetype renders from. One formatting layer, two surfaces: a
 * `money` field looks like money in a table row and on a record.
 *
 * A property says how it wants to be read with an `x-display` annotation
 * beside its `type` — `{role, format, tones, group, to, order}` — and every
 * part of it has a default derived from the JSON Schema itself, so a type
 * that annotates nothing still renders sensibly.
 */

/** Where a field belongs on the page. */
export type RecordRole = 'prose' | 'fact' | 'link' | 'timestamp';

export type RecordField = PageField & {
  role: RecordRole;
  /** The heading this fact sits under in the side column. */
  group: string;
  /** Sort key within its section; declaration order breaks ties. */
  order: number;
  /** The property's own words, shown as a hint beside a fact. */
  hint?: string;
};

/**
 * The substantial prose a record carries, whatever type it is: what it is
 * for, what was said, what was decided. Named rather than guessed because
 * "a long string" is not the same thing as "a paragraph a person reads".
 */
const PROSE_KEYS = new Set(['objective', 'body', 'summary', 'notes', 'reason', 'answer', 'announcement', 'description', 'requestSummary', 'priorityReason', 'decisionReason', 'explanation']);

/** Keys that are a moment rather than a fact, and read last. */
const TIMESTAMP_FORMATS = new Set(['date-time', 'date']);

type Prop = Record<string, unknown>;

function displayOf(prop: Prop): Prop {
  const d = prop['x-display'];
  return d && typeof d === 'object' ? d as Prop : {};
}

/**
 * A key as a label: `estimateCents` → `Estimate cents`, `prUrl` → `Pr url`.
 * @param key
 */
function labelFromKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * How a property renders when it did not say. Derived from the JSON Schema
 * it already carries, so `format: date-time` is a date, an `enum` is a
 * badge, a list is a checklist, and a key that ends in `Cents` is money.
 * @param key - The property name.
 * @param prop - The JSON Schema property.
 */
function formatFor(key: string, prop: Prop): PageField['format'] {
  const jsonFormat = typeof prop.format === 'string' ? prop.format : '';
  if (TIMESTAMP_FORMATS.has(jsonFormat)) {
    return 'date';
  }
  if (jsonFormat === 'uri' || /url$/i.test(key)) {
    return 'link';
  }
  if (Array.isArray(prop.enum)) {
    return 'badge';
  }
  if (prop.type === 'array') {
    return 'steps';
  }
  if (/cents$/i.test(key)) {
    return 'money';
  }
  if (/^(?:id|.*(?:Sha|Slug|Branch|Version|Id))$/.test(key)) {
    return 'mono';
  }
  return 'text';
}

/**
 * Which part of the page a field belongs to when it did not say: a link if
 * it resolves to a record or a URL, a timestamp if it is a moment, prose if
 * it is one of the paragraphs a person reads, a fact otherwise.
 * @param key - The property name.
 * @param prop - The JSON Schema property.
 * @param format - The resolved format.
 * @param to - The target type a `link` resolves against, if declared.
 */
function roleFor(key: string, prop: Prop, format: PageField['format'], to: string | undefined): RecordRole {
  if (to || format === 'link') {
    return 'link';
  }
  if (format === 'date') {
    return 'timestamp';
  }
  if (PROSE_KEYS.has(key) && prop.type === 'string') {
    return 'prose';
  }
  return 'fact';
}

/**
 * Every field the type declares, in the order a page should read them.
 * @param schema - The type's JSON Schema (`business_object_type.schema`).
 */
export function declaredRecordFields(schema: unknown): RecordField[] {
  const props = (schema as Prop | null)?.properties;
  if (!props || typeof props !== 'object') {
    return [];
  }
  const out: RecordField[] = [];
  let i = 0;
  for (const [key, rawProp] of Object.entries(props as Record<string, unknown>)) {
    const prop = (rawProp && typeof rawProp === 'object' ? rawProp : {}) as Prop;
    const d = displayOf(prop);
    if (d.hidden === true) {
      continue;
    }
    const to = typeof d.to === 'string' ? d.to : undefined;
    const format = (typeof d.format === 'string' ? d.format : formatFor(key, prop)) as PageField['format'];
    const role = (typeof d.role === 'string' ? d.role : roleFor(key, prop, format, to)) as RecordRole;
    out.push({
      key,
      label: typeof d.label === 'string' ? d.label : typeof prop.title === 'string' ? prop.title : labelFromKey(key),
      from: `meta.${key}`,
      format,
      to,
      tones: (d.tones && typeof d.tones === 'object' ? d.tones : undefined) as PageField['tones'],
      total: false,
      priority: 1,
      hideWhenConstant: false,
      detail: false,
      align: undefined,
      role,
      group: typeof d.group === 'string' ? d.group : 'Details',
      order: typeof d.order === 'number' ? d.order : i,
      hint: typeof prop.description === 'string' ? prop.description : undefined,
    });
    i += 1;
  }
  return out.sort((a, b) => a.order - b.order);
}

export type RecordSections = {
  prose: RecordField[];
  /** Short facts, by the group they were declared under, in first-seen order. */
  facts: Array<{ group: string; fields: RecordField[] }>;
  links: RecordField[];
  timestamps: RecordField[];
  /** Metadata keys the record carries that its type never declared. */
  otherKeys: string[];
};

/**
 * The record, laid out. A declared field the record has no value for is
 * left out rather than shown blank; a value the record carries that the
 * type never declared is named in `otherKeys` so nothing is invisible.
 * @param row - The record, in the same shape a list row has.
 * @param fields - What {@link declaredRecordFields} read off the type.
 * @param handled - Metadata keys the surface renders itself (a discovery
 * call's topics, an inspection's regions), which are therefore not
 * "invisible" and do not belong in the Other fields block.
 */
export function recordSections(row: PageRow, fields: RecordField[], handled: readonly string[] = []): RecordSections {
  const present = fields.filter(f => !isEmptyValue(resolveField(row, f.from ?? f.key)));
  const facts: Array<{ group: string; fields: RecordField[] }> = [];
  for (const f of present.filter(f => f.role === 'fact')) {
    const hit = facts.find(g => g.group === f.group);
    if (hit) {
      hit.fields.push(f);
    } else {
      facts.push({ group: f.group, fields: [f] });
    }
  }
  const declared = new Set([...fields.map(f => f.key), ...handled]);
  return {
    prose: present.filter(f => f.role === 'prose'),
    facts,
    links: present.filter(f => f.role === 'link'),
    timestamps: present.filter(f => f.role === 'timestamp'),
    otherKeys: Object.keys(row.meta)
      .filter(k => !declared.has(k) && !isEmptyValue(row.meta[k]))
      .sort(),
  };
}

/**
 * Whether this record is a discovery call — the only kind of record the
 * "Discovery Summary" block, and its sentence about analysing linked
 * documents to overview *this discovery call*, is true of. It used to
 * render on every object of every type; it renders now only when the
 * record actually carries a discovery call's own fields.
 * @param meta - The record's metadata.
 */
export function isDiscoveryRecord(meta: Record<string, unknown>): boolean {
  const topics = meta.key_topics ?? meta.topics;
  return (Array.isArray(topics) && topics.length > 0) || (Array.isArray(meta.next_steps) && meta.next_steps.length > 0);
}

/**
 * Whether this record is image-backed — an inspection, a scan — and so
 * has a picture for the vision block to read.
 * @param meta - The record's metadata.
 */
export function hasInspectionImage(meta: Record<string, unknown>): boolean {
  return typeof meta.image_url === 'string' && meta.image_url !== '';
}
