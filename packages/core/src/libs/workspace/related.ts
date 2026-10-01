import type { RecordType } from '@/services/chat/pageContext';
import { z } from 'zod';

/**
 * RELATED — WHAT A RECORD IS CONNECTED TO (Chris, 2026-09-30: "this is
 * functionality that should be core and extendable"). The chat that started
 * it, its plan, its tasks, its runs, its pull request, its releases, its
 * artifacts: each a row on the record's page and in its preview, one move
 * from the full page and one from the pane.
 *
 * Core ships the mechanism; the workspace ships the meaning. What a type is
 * connected to is DECLARED on the type (`x-related` in its `type.yaml`
 * schema, beside `x-owner` and `x-gates`), in terms of what the records
 * already say — a metadata key naming another record, a key on other records
 * naming this one, a URL — never by core code naming a type. Two relations
 * are core's own and need no declaration: the chat that started the record
 * (`origin`, always first) and the artifacts attached to it.
 *
 * Pure and client-safe: the descriptor and the item shape. The read is
 * `services/objects/related.ts`; the block is `components/patterns/Related`.
 */

/**
 * One relation, as a type declares it.
 *
 *   origin     the conversation that asked for the record
 *   links      records named by THIS record's `field` (an id, a list of ids,
 *              or — with `match` — a value compared to the other record's
 *              metadata `match`, e.g. a product slug)
 *   backlinks  records whose metadata `field` names this one (its id, or —
 *              with `match` — this record's metadata `match`)
 *   runs       engineering runs built for this record, or for the records of
 *              relation `of`
 *   url        an https link held in `field`, on this record or on the
 *              records of relation `of` (a pull request); opens outside
 *   artifacts  artifacts attached to the record (optionally one `role`)
 *   wiki       wiki pages about the record: the page slugs THIS record's
 *              `field` names (a slug or a list), and — with `match` — the
 *              pages tagged with this record's metadata `match` (a product's
 *              slug), or whose slug is that value followed by a dash
 *              (`send-standards` for `send`). A wiki page is not a record, so
 *              it has no key naming the record; these are what it carries.
 */
export const RelationSchema = z.object({
  key: z.string().regex(/^[a-z][\w-]{0,39}$/i),
  label: z.string().min(1).max(40),
  from: z.enum(['origin', 'links', 'backlinks', 'runs', 'url', 'artifacts', 'wiki']),
  field: z.string().min(1).max(60).optional(),
  /** The other side's key, for a relation matched on a value rather than an id. */
  match: z.string().min(1).max(60).optional(),
  /** Only records of this type. */
  type: z.string().min(1).max(60).optional(),
  /** Read from the records of this earlier relation, not this record. */
  of: z.string().min(1).max(40).optional(),
  /** artifacts: only this record role. */
  role: z.string().min(1).max(40).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  /**
   * What each related record says under its link, from its own metadata, in
   * order: its URL, its stage, the commit it runs and when, its health.
   * `format`: `text` as written; `sha` its first 7 characters; `relative`
   * a moment as "3h ago"; `count` a list's length ("3 checks" with `label`);
   * `present` says `present` or `absent` depending on whether it has one.
   * `pick` reads an object field's entry under THIS record's metadata `pick`
   * (a repository's paths for this product's slug).
   */
  details: z.array(z.object({
    field: z.string().min(1).max(60),
    label: z.string().min(1).max(30).optional(),
    format: z.enum(['text', 'sha', 'relative', 'count', 'present']).default('text'),
    present: z.string().min(1).max(40).optional(),
    absent: z.string().min(1).max(40).optional(),
    pick: z.string().min(1).max(60).optional(),
  })).max(8).optional(),
});

/**
 * A FIELD READ FROM ITS RECORDS, NOT STORED BESIDE THEM (Chris, 2026-09-30:
 * a product's `urls` and `repos` drifted from the environment and repository
 * records the deploys write — #246's live link was a guessed host). Declared
 * on the type as `x-derived: {<field>: …}`: the field's value is read, at
 * read time, from the records of one of the type's relations. A list of their
 * `value` (a product's repositories by slug), or with `keyBy` an object keyed
 * by each record's `keyBy` (`keys` renames them: `app: web`), optionally only
 * the records whose `where` fields equal the given values. A stored value that
 * disagrees is drift: shown, never silently preferred.
 */
export const DerivedSchema = z.object({
  relation: z.string().min(1).max(40),
  value: z.string().min(1).max(60),
  keyBy: z.string().min(1).max(60).optional(),
  keys: z.record(z.string(), z.string()).optional(),
  where: z.record(z.string(), z.string()).optional(),
});

export type Derived = z.infer<typeof DerivedSchema>;

/**
 * A type's derived fields, the ones that parse.
 * @param schema - The type's stored schema.
 */
export function derivedOf(schema: Record<string, unknown> | null | undefined): Record<string, Derived> {
  const raw = schema?.['x-derived'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(([field, d]) => {
    const parsed = DerivedSchema.safeParse(d);
    return parsed.success ? [[field, parsed.data] as const] : [];
  }));
}

/**
 * A derived field's value from the records of its relation.
 * @param d - The declaration.
 * @param records - The relation's records' metadata (with `slug`/`id` as they are).
 */
export function deriveValue(d: Derived, records: ReadonlyArray<Record<string, unknown>>): unknown {
  const kept = records.filter(r => Object.entries(d.where ?? {}).every(([k, v]) => String(r[k] ?? '') === v));
  if (!d.keyBy) {
    return [...new Set(kept.map(r => r[d.value]).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number'))];
  }
  const rename = new Map(Object.entries(d.keys ?? {}).map(([to, from]) => [from, to]));
  const out: Record<string, unknown> = {};
  for (const r of kept) {
    const k = typeof r[d.keyBy] === 'string' ? r[d.keyBy] as string : null;
    if (k !== null && r[d.value] !== undefined && out[rename.get(k) ?? k] === undefined) {
      out[rename.get(k) ?? k] = r[d.value];
    }
  }
  return out;
}

/**
 * Where a stored value disagrees with the derived one, in words — one line per
 * key (an object) or one for the list; empty when they agree or nothing is stored.
 * @param field - The field.
 * @param stored - What the record holds.
 * @param derived - What its records say.
 */
export function driftOf(field: string, stored: unknown, derived: unknown): string[] {
  if (stored === undefined || stored === null || stored === '') {
    return [];
  }
  if (Array.isArray(derived)) {
    const have = new Set((Array.isArray(stored) ? stored : [stored]).map(String));
    const want = new Set(derived.map(String));
    const same = have.size === want.size && [...have].every(v => want.has(v));
    return same ? [] : [`Stored ${field} says ${[...have].join(', ') || 'nothing'}; the records say ${[...want].join(', ') || 'nothing'}.`];
  }
  if (derived && typeof derived === 'object' && stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const d = derived as Record<string, unknown>;
    return Object.entries(stored as Record<string, unknown>).flatMap(([k, v]) => {
      if (v === undefined || v === null || v === '') {
        return [];
      }
      if (!(k in d)) {
        return [`Stored ${field}.${k} is ${String(v)}; no record says so.`];
      }
      return String(d[k]) === String(v) ? [] : [`Stored ${field}.${k} is ${String(v)}; the record says ${String(d[k])}.`];
    });
  }
  return [];
}

export type Relation = z.infer<typeof RelationSchema>;

/** The relations core draws for every record, whatever its type declares. */
export const CORE_RELATIONS: readonly Relation[] = [
  { key: 'origin', label: 'Started in chat', from: 'origin', limit: 1 },
  { key: 'artifacts', label: 'Artifacts', from: 'artifacts', limit: 10 },
];

/**
 * A type's relations: the chat that started it first, then what the type
 * declares (`x-related`, in order), then its artifacts — each key once. A
 * declaration that does not parse is dropped, never thrown: a page with one
 * bad row still draws the rest. A type that declares none is connected to
 * what its link fields name.
 * @param schema - The type's stored schema.
 */
export function relationsOf(schema: Record<string, unknown> | null | undefined): Relation[] {
  const raw = Array.isArray(schema?.['x-related']) ? schema['x-related'] as unknown[] : null;
  const declared = raw
    ? raw.flatMap((r) => {
        const parsed = RelationSchema.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      })
    : linkFieldRelations(schema);
  const byKey = new Map<string, Relation>();
  for (const r of [CORE_RELATIONS[0]!, ...declared, CORE_RELATIONS[1]!]) {
    if (!byKey.has(r.key)) {
      byKey.set(r.key, declared.find(d => d.key === r.key) ?? r);
    }
  }
  return [...byKey.values()];
}

/**
 * A type that declares no relations is still connected to what its fields
 * name: every property whose display says it links to another type
 * (`x-display: {to: <type>}`) is a `links` relation, labelled as the field is.
 * @param schema - The type's stored schema.
 */
function linkFieldRelations(schema: Record<string, unknown> | null | undefined): Relation[] {
  const props = (schema?.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, unknown>;
  return Object.entries(props).flatMap(([key, def]) => {
    const display = ((def as Record<string, unknown> | null)?.['x-display'] ?? {}) as Record<string, unknown>;
    if (typeof display.to !== 'string' || !display.to) {
      return [];
    }
    const parsed = RelationSchema.safeParse({ key, label: typeof display.label === 'string' && display.label ? display.label.slice(0, 40) : key, from: 'links', field: key, type: display.to });
    return parsed.success ? [parsed.data] : [];
  });
}

/** One thing a record is connected to, as the Related block draws it. */
export type RelatedItem = {
  /** Unique within the list. */
  key: string;
  /** The relation it belongs to, and its label ("Started in chat"). */
  relation: string;
  label: string;
  /** What the link says. */
  title: string;
  /** Its full page (in-app, relative) or its outside URL; null when it has neither. */
  href: string | null;
  /** The href leaves Vocion: opens in a new tab, has no preview. */
  external: boolean;
  /** What the preview pane opens, when it can show it. */
  preview: { type: RecordType; id: string } | null;
  /**
   * `drift`: a stored value disagreeing with the records this relation reads (`x-derived`), shown under the row.
   * `page`: a wiki page (an artifact), whose `details` are its first lines and `at` its last update.
   */
  kind: 'record' | 'artifact' | 'run' | 'conversation' | 'link' | 'drift' | 'page';
  /** A few words after the link: a status, a role. */
  note: string | null;
  /** What the record says under its link (its declared `details`), each a short phrase. */
  details?: string[];
  /** ISO, when the item has a moment worth showing. */
  at: string | null;
};

/**
 * Items grouped by relation, in the order they came.
 * @param items - The list.
 */
export function groupRelated(items: readonly RelatedItem[]): Array<{ relation: string; label: string; items: RelatedItem[] }> {
  const out: Array<{ relation: string; label: string; items: RelatedItem[] }> = [];
  for (const item of items) {
    const g = out.find(x => x.relation === item.relation);
    if (g) {
      g.items.push(item);
    } else {
      out.push({ relation: item.relation, label: item.label, items: [item] });
    }
  }
  return out;
}
