/**
 * file_<type> — a record filed through a tool whose arguments ARE the type.
 *
 * Conversation 353 (2026-09-28): "File a feature request for Stamp: …". The
 * product manager called propose_action → objects.propose_candidate with the
 * fields it guessed a request holds — `description`, `requestedBy`, `product:
 * "Stamp"`, no `dedupOn` — and was refused twice: once for the missing
 * `dedupOn`, once for the proposal-ready bar (story, outcome, acceptance). It
 * gave up and asked the person a question they had already answered. The
 * cause is the shape of the tool, not the model: `fields` is free-form, so
 * every call is a guess at a schema the model never sees.
 *
 * So a type that opts in (`x-agent-file` on its schema, in type.yaml) gets a
 * tool generated from it:
 *
 *   - its properties are the type's fields (narrowed by `x-agent-file.fields`
 *     and `omit`), with the type's own descriptions;
 *   - required is the type's `required` plus what its proposal-ready gate
 *     (`gates:` with `when: {field: status, becomes: [candidate]}`) demands,
 *     nested paths included (`visuals.surfaceUrl`), `minItems` carried;
 *   - a string field that links to another type (`x-display.to`) is an enum
 *     of that type's record slugs in this workspace, read at build time, so
 *     `product` is `send`, never `Stamp`;
 *   - `dedupOn` comes from the type (`x-agent-file.dedupOn`), never from the
 *     model.
 *
 * The call goes down the same path propose_action takes
 * (`runProposal` → objects.propose_candidate, trust key
 * `objects.propose_candidate.<type>`, the same gates and the same DONE answer
 * with the record's link). The tool schema is plain zod — no transforms — so
 * it converts to JSON Schema for every provider (registry.schema.test.ts).
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { GateRequirement } from '@/libs/gates/handoffGate';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { gatesOf } from '@/libs/gates/handoffGate';
import { runProposal } from './proposeAction';

type JsonSchema = Record<string, unknown>;

/** A type's `x-agent-file` block: `true`, or what to narrow. */
type AgentFileConfig = {
  /** Which fields identify one record, for dedup. Default `[title]`. */
  dedupOn?: string[];
  /** The fields a filer writes. Default: every declared field. */
  fields?: string[];
  /** Dotted paths to leave out (`acceptance.met` reaches into an array's items). */
  omit?: string[];
};

/** One opted-in type, resolved into what its tool is built from. */
export type FilingType = {
  slug: string;
  label: string;
  description?: string;
  /** `file_<slug>`. */
  toolName: string;
  /** The tool's field properties as JSON Schema, references resolved, required marked. */
  properties: Record<string, JsonSchema>;
  /** Field names the tool requires, beside `title`. */
  required: string[];
  /** The type's identity fields, set on every call. */
  dedupOn: string[];
  /** The type declares a `title` field; the tool's title is written onto it. */
  titleIsField: boolean;
  /** The type's own words for its title, when it has a title field. */
  titleDescription?: string;
};

/** Keywords of a property that survive into the tool's schema. Everything else (x-display, format…) stays in the type. */
const KEPT = ['type', 'description', 'enum', 'items', 'properties', 'required', 'minimum', 'maximum', 'minItems', 'maxItems'] as const;

/** An enum of record slugs is useful up to a point; past it the field stays a string. */
const MAX_REFERENCE_ENUM = 100;

/**
 * The opt-in, or null when the type has none.
 * @param schema - A stored type schema.
 */
function agentFileConfig(schema: JsonSchema | null | undefined): AgentFileConfig | null {
  const raw = schema?.['x-agent-file'];
  if (raw === true) {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : undefined);
  return { dedupOn: list(r.dedupOn), fields: list(r.fields), omit: list(r.omit) };
}

/**
 * The tool's name for a type slug.
 * @param slug - The object type slug.
 */
function filingToolName(slug: string): string {
  return `file_${slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 64);
}

/**
 * The declared properties of a type schema.
 * @param schema - A stored type schema.
 */
function propertiesOf(schema: JsonSchema | null | undefined): Record<string, JsonSchema> {
  const p = schema?.properties;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, JsonSchema>) : {};
}

/**
 * The fields a filer writes, in declared order when none are named.
 * @param schema - A stored type schema.
 * @param cfg - The opt-in.
 */
function filedFieldNames(schema: JsonSchema | null | undefined, cfg: AgentFileConfig): string[] {
  const props = propertiesOf(schema);
  const names = cfg.fields ?? Object.keys(props);
  return names.filter(n => n !== 'title' && props[n] && typeof props[n] === 'object');
}

/**
 * The types an opted-in type's filed fields reference by slug (`x-display.to`
 * on a string field) — the record lists the tool's enums are read from.
 * @param schema - A stored type schema.
 */
function referenceTypesOf(schema: JsonSchema | null | undefined): string[] {
  const cfg = agentFileConfig(schema);
  if (!cfg) {
    return [];
  }
  const props = propertiesOf(schema);
  const out = new Set<string>();
  for (const name of filedFieldNames(schema, cfg)) {
    const to = referenceOf(props[name]!);
    if (to) {
      out.add(to);
    }
  }
  return [...out];
}

/**
 * The type a string field links to, when it does.
 * @param prop - One property.
 */
function referenceOf(prop: JsonSchema): string | undefined {
  const display = prop['x-display'] as { to?: unknown } | undefined;
  return prop.type === 'string' && typeof display?.to === 'string' ? display.to : undefined;
}

/**
 * One property as the tool states it: the kept keywords, nested properties
 * cleaned the same way, omitted paths dropped.
 * @param prop - The type's property.
 * @param path - Its dotted path from the record root.
 * @param omit - Paths to leave out.
 */
function cleanProperty(prop: JsonSchema, path: string, omit: Set<string>): JsonSchema {
  const out: JsonSchema = {};
  for (const key of KEPT) {
    if (prop[key] !== undefined) {
      out[key] = prop[key];
    }
  }
  if (prop.format === 'date-time' && typeof out.description === 'string') {
    out.description = `${out.description} An ISO 8601 date-time.`;
  }
  if (out.properties && typeof out.properties === 'object') {
    const nested: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(out.properties as Record<string, JsonSchema>)) {
      if (!omit.has(`${path}.${k}`) && v && typeof v === 'object') {
        nested[k] = cleanProperty(v, `${path}.${k}`, omit);
      }
    }
    out.properties = nested;
    if (Array.isArray(out.required)) {
      out.required = (out.required as unknown[]).filter(r => typeof r === 'string' && r in nested);
    }
  }
  if (out.items && typeof out.items === 'object' && !Array.isArray(out.items)) {
    // An array's items share its path: `acceptance.met` names the items' `met`.
    out.items = cleanProperty(out.items as JsonSchema, path, omit);
  }
  return out;
}

/**
 * The requirements a record must meet to BECOME a candidate — the bar
 * objects.propose_candidate enforces at the door — plus the schema's own
 * top-level `required`.
 * @param schema - A stored type schema.
 */
function candidateRequirements(schema: JsonSchema | null | undefined): GateRequirement[] {
  const gated = gatesOf(schema)
    .filter(g => g.when.field === 'status' && g.when.becomes.includes('candidate'))
    .flatMap(g => g.require)
    .filter(r => !r.if && !r.anyOf && (r.present || r.minItems !== undefined));
  const own = Array.isArray(schema?.required) ? (schema.required as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  return [...gated, ...own.map(field => ({ field, present: true }))];
}

/**
 * Mark one requirement on the tool's properties: every segment of its path
 * required, `minItems` carried, its message appended to the description.
 * @param properties - The tool's properties, mutated.
 * @param required - The tool's top-level required list, mutated.
 * @param r - The requirement.
 */
function markRequired(properties: Record<string, JsonSchema>, required: Set<string>, r: GateRequirement): void {
  const [head, ...rest] = r.field.split('.');
  const top = head ? properties[head] : undefined;
  if (!head || !top) {
    return;
  }
  required.add(head);
  let node = top;
  for (const seg of rest) {
    const props = (node.properties ?? {}) as Record<string, JsonSchema>;
    const next = props[seg];
    if (!next) {
      return;
    }
    const req = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    req.add(seg);
    node.required = [...req];
    node = next;
  }
  if (r.minItems !== undefined && node.type === 'array') {
    node.minItems = Math.max(Number(node.minItems ?? 0), r.minItems);
  }
  if (r.message) {
    node.description = `${typeof node.description === 'string' ? `${node.description} ` : ''}Required to file: ${r.message}.`;
  }
}

/**
 * What an opted-in type's tool is built from. Pure: the record slugs a
 * reference field may take are handed in.
 * @param type - The stored type.
 * @param type.slug - Its slug.
 * @param type.label - Its label.
 * @param type.description - Its description.
 * @param type.schema - Its stored schema (gates inside, as `x-gates`).
 * @param references - Record slugs by type slug, for `x-display.to` fields.
 */
export function filingTypeOf(
  type: { slug: string; label: string; description?: string | null; schema: JsonSchema | null },
  references: Record<string, string[]> = {},
): FilingType | null {
  const cfg = agentFileConfig(type.schema);
  if (!cfg) {
    return null;
  }
  const declared = propertiesOf(type.schema);
  const omit = new Set(cfg.omit ?? []);
  const properties: Record<string, JsonSchema> = {};
  for (const name of filedFieldNames(type.schema, cfg)) {
    if (omit.has(name)) {
      continue;
    }
    const prop = cleanProperty(declared[name]!, name, omit);
    const to = referenceOf(declared[name]!);
    const slugs = to ? (references[to] ?? []) : [];
    if (to && slugs.length > 0 && slugs.length <= MAX_REFERENCE_ENUM) {
      prop.enum = slugs;
      prop.description = `${typeof prop.description === 'string' ? `${prop.description} ` : ''}One of this workspace's ${to} records, by slug: ${slugs.join(', ')}.`;
    }
    properties[name] = prop;
  }
  const required = new Set<string>();
  for (const r of candidateRequirements(type.schema)) {
    if (r.field !== 'title') {
      markRequired(properties, required, r);
    }
  }
  const titleIsField = Boolean(declared.title);
  const dedupOn = (cfg.dedupOn ?? ['title']).filter(f => f === 'title' || f in properties);
  return {
    slug: type.slug,
    label: type.label,
    description: type.description ?? undefined,
    toolName: filingToolName(type.slug),
    properties,
    required: [...required],
    dedupOn: dedupOn.length > 0 ? dedupOn : ['title'],
    titleIsField,
    titleDescription: typeof declared.title?.description === 'string' ? declared.title.description : undefined,
  };
}

/**
 * A JSON Schema property as plain zod — types, enums, bounds, nested objects
 * and arrays, descriptions. No transforms, so the schema converts back to
 * JSON Schema for every provider.
 * @param js - One property.
 */
function zodOf(js: JsonSchema): z.ZodType {
  let out: z.ZodType;
  const values = Array.isArray(js.enum) ? (js.enum as unknown[]) : undefined;
  const itemsOf = (): z.ZodType => (js.items && typeof js.items === 'object' ? zodOf(js.items as JsonSchema) : z.unknown());
  if (values && values.length > 0 && values.every(v => typeof v === 'string')) {
    out = z.enum(values as [string, ...string[]]);
  } else if (js.type === 'string') {
    out = z.string();
  } else if (js.type === 'integer' || js.type === 'number') {
    let n = js.type === 'integer' ? z.number().int() : z.number();
    if (typeof js.minimum === 'number') {
      n = n.min(js.minimum);
    }
    if (typeof js.maximum === 'number') {
      n = n.max(js.maximum);
    }
    out = n;
  } else if (js.type === 'boolean') {
    out = z.boolean();
  } else if (js.type === 'array') {
    let a = z.array(itemsOf());
    if (typeof js.minItems === 'number') {
      a = a.min(js.minItems);
    }
    if (typeof js.maxItems === 'number') {
      a = a.max(js.maxItems);
    }
    out = a;
  } else if (js.type === 'object' && js.properties && typeof js.properties === 'object') {
    const req = new Set(Array.isArray(js.required) ? (js.required as string[]) : []);
    const shape: Record<string, z.ZodType> = {};
    for (const [k, v] of Object.entries(js.properties as Record<string, JsonSchema>)) {
      shape[k] = req.has(k) ? zodOf(v) : zodOf(v).optional();
    }
    out = z.object(shape);
  } else if (js.type === 'object') {
    out = z.record(z.string(), z.unknown());
  } else {
    out = z.unknown();
  }
  return typeof js.description === 'string' ? out.describe(js.description) : out;
}

/** The two envelope arguments beside the fields, when the type does not declare the same names. */
const ENVELOPE = ['confidence', 'rationale'] as const;

/**
 * The tool's input schema: `title`, the type's fields, and the envelope.
 * @param spec - The filing type.
 */
export function filingSchema(spec: FilingType): z.ZodObject {
  const required = new Set(spec.required);
  const shape: Record<string, z.ZodType> = {
    title: z.string().min(1).max(500).describe(spec.titleDescription ?? `One line naming this ${spec.label.toLowerCase()}.`),
  };
  for (const [name, js] of Object.entries(spec.properties)) {
    shape[name] = required.has(name) ? zodOf(js) : zodOf(js).optional();
  }
  if (!('confidence' in spec.properties)) {
    shape.confidence = z.number().min(0).max(1).optional().describe('Your confidence this is what was asked for, 0–1. It decides whether the record is filed now or waits for a person.');
  }
  if (!('rationale' in spec.properties)) {
    shape.rationale = z.string().max(1000).optional().describe('One sentence a person could check: what you understood was asked, and from where.');
  }
  return z.object(shape);
}

/**
 * The typed filing tool for one type.
 * @param ctx - The turn.
 * @param spec - The filing type.
 */
function fileRecordTool(ctx: RuntimeContext, spec: FilingType): StructuredToolInterface {
  const label = spec.label.toLowerCase();
  const required = ['title', ...spec.required];
  const built = tool(
    async (raw) => {
      const args = raw as Record<string, unknown>;
      const title = String(args.title ?? '').trim();
      const fields: Record<string, unknown> = {};
      for (const name of Object.keys(spec.properties)) {
        if (args[name] !== undefined) {
          fields[name] = args[name];
        }
      }
      if (spec.titleIsField || spec.dedupOn.includes('title')) {
        fields.title = title;
      }
      const c = ENVELOPE[0] in spec.properties ? undefined : args.confidence;
      const confidence = typeof c === 'number' && c >= 0 && c <= 1 ? c : 0.8;
      const r = ENVELOPE[1] in spec.properties ? undefined : args.rationale;
      const rationale = typeof r === 'string' && r.trim() ? r.trim() : `Filing the ${label} asked for in this conversation.`;
      return runProposal(ctx, {
        actionId: 'objects.propose_candidate',
        // dedupOn is the TYPE's, never the model's: the call that forgot it
        // was refused, and the one that guessed it split one ask in two.
        input: { objectType: spec.slug, title, fields, dedupOn: spec.dedupOn },
        confidence,
        rationale,
        suggestedDecision: 'approve',
        suggestedDecisionReason: rationale.slice(0, 160),
      }, {
        tool: spec.toolName,
        refused: (code, message) => `Refused: nothing was filed (${code}). ${message} Call ${spec.toolName} again with those fields.`,
      });
    },
    {
      name: spec.toolName,
      description: `File one ${label} record. Use this — not propose_action — whenever a ${label} is to be filed: the arguments ARE the ${label}'s fields, with the ones it must carry marked required (${required.join(', ')}). Transcribe what the person asked for; write what the thread settled; never ask them to restate it. Identity (dedup) is set for you. Filed done-for-you within the workspace's trust bar; the answer names the record and its link, which is what you tell the person.${spec.description ? ` About a ${label}: ${spec.description.slice(0, 600)}` : ''}`,
      schema: filingSchema(spec),
    },
  );
  // Which type this tool files, so the owed-write pass can pick it
  // (`owedWriteBackstop.ts`) without parsing a name.
  return Object.assign(built, { filesType: spec.slug });
}

/**
 * The typed filing tools this agent has: one per opted-in type it works with.
 * @param ctx - The turn.
 */
export function fileRecordTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return (ctx.filingTypes ?? [])
    .filter(t => ctx.objectTypeSlugs.includes(t.slug))
    .map(t => fileRecordTool(ctx, t));
}

/**
 * The opted-in types among the agent's own, resolved against this
 * workspace's records. Never throws: a type that cannot be read is simply
 * filed the generic way.
 * @param orgId - The workspace.
 * @param objectTypeSlugs - The agent's object types.
 */
export async function loadFilingTypes(orgId: string, objectTypeSlugs: readonly string[]): Promise<FilingType[]> {
  if (objectTypeSlugs.length === 0) {
    return [];
  }
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ slug: businessObjectTypeSchema.slug, label: businessObjectTypeSchema.label, description: businessObjectTypeSchema.description, schema: businessObjectTypeSchema.schema })
    .from(businessObjectTypeSchema)
    .where(and(eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, [...objectTypeSlugs])));
  const opted = rows.filter(r => agentFileConfig(r.schema));
  if (opted.length === 0) {
    return [];
  }
  const references = await recordSlugsByType(orgId, [...new Set(opted.flatMap(r => referenceTypesOf(r.schema)))]);
  return opted.map(r => filingTypeOf(r, references)).filter((t): t is FilingType => t !== null);
}

/**
 * The slugs (`metadata.slug`) of the live records of each type — the values
 * a reference field may take. Candidates and rejected records are not yet,
 * or no longer, things a record can belong to.
 * @param orgId - The workspace.
 * @param typeSlugs - The referenced types.
 */
async function recordSlugsByType(orgId: string, typeSlugs: string[]): Promise<Record<string, string[]>> {
  if (typeSlugs.length === 0) {
    return {};
  }
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ type: businessObjectTypeSchema.slug, slug: sql<string | null>`${businessObjectSchema.metadata}->>'slug'` })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      inArray(businessObjectTypeSchema.slug, typeSlugs),
      sql`coalesce(${businessObjectSchema.status}, 'active') not in ('candidate', 'rejected', 'archived')`,
    ))
    .limit(1000);
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    if (typeof row.slug === 'string' && row.slug.trim()) {
      const list = (out[row.type] ??= []);
      if (!list.includes(row.slug)) {
        list.push(row.slug);
      }
    }
  }
  for (const list of Object.values(out)) {
    list.sort();
  }
  return out;
}
