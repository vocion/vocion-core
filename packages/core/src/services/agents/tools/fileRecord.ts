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
 *
 * A GAP OR AN IDEA CHECKS WHAT ALREADY SHIPS, WITHOUT A ROUND TRIP THE MODEL
 * HAS TO REMEMBER TO ASK FOR. #873 gave `request`'s proposal-ready gate a
 * `readThisTurn` requirement: a gap or an idea names the product's
 * capabilities page (`gapCheck.sources`) AND the turn must have opened it
 * with `read_wiki_page`. A conversation on 2026-09-29 showed the gap in that
 * design: `ask_workspace`'s product-manager called `file_request` twice, was
 * refused both times with the same "opened with read_wiki_page in this turn"
 * message, and never once called `read_wiki_page` — a gate that only a
 * second tool call satisfies is a prompt lever wearing a gate's clothes. So
 * `capabilitiesToCheck` below reads the page itself, server-side, the
 * moment a gap or an idea needs it and the turn has not read it — recorded
 * exactly as `read_wiki_page` would be (`recordCapabilitiesRead`, the same
 * `tool_call` shape `services/gates/turnReads.ts` already checks) — and,
 * while the filing's own `gapCheck.sources` still does not cite that page,
 * answers with the page's own words instead of filing: what the product
 * already ships, and what to call again with. Citing the page is still the
 * model's decision (finding: add, modify or none) — this only removes the
 * tool call the model kept forgetting to make.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { GateRequirement } from '@/libs/gates/handoffGate';
import type { WikiPage } from '@/services/wiki/WikiService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { resolveIncludeTarget } from '@/libs/actions/objects-propose-candidate';
import { gatesOf, sourceKey } from '@/libs/gates/handoffGate';
import { noteTurnRead, readsThisTurn } from '@/services/gates/turnReads';
import { readBeforeFiling, referenceReadOf } from '@/services/objects/referenceRead';
import { renderWikiPageBody } from '@/services/wiki/WikiService';
import { persistToolCall } from '../toolCallRecord';
import { filingOnPersonsWord, runProposal } from './proposeAction';

type JsonSchema = Record<string, unknown>;

/** A type's `x-agent-file` block: `true`, or what to narrow. */
type AgentFileConfig = {
  /** Which fields identify one record, for dedup. Default `[title]`. */
  dedupOn?: string[];
  /** The fields a filer writes. Default: every declared field. */
  fields?: string[];
  /** Dotted paths to leave out (`acceptance.met` reaches into an array's items). */
  omit?: string[];
  /** The field a title longer than the title's `maxLength` is kept in, as the ask, before a model names the record. */
  longTitleTo?: string;
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
  /** The longest title the type wants (its title's `maxLength`), when it says. */
  titleMax?: number;
  /** Where a longer title's words are kept (`x-agent-file.longTitleTo`), when the type says. */
  longTitleTo?: string;
  /**
   * The type's raw stored schema (gates inside, as `x-gates`) — kept for
   * `capabilitiesToCheck`, which needs the full schema (`x-display.to`, the
   * candidate-ready gate's `readThisTurn` requirement) that the tool's own
   * narrowed `properties` above deliberately strips.
   */
  schema: JsonSchema | null;
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
  return { dedupOn: list(r.dedupOn), fields: list(r.fields), omit: list(r.omit), longTitleTo: typeof r.longTitleTo === 'string' && r.longTitleTo.trim() ? r.longTitleTo.trim() : undefined };
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
    .filter(g => g.when.field === 'status' && (g.when.becomes ?? []).includes('candidate'))
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
 * @param names - What each of those records is called, by type then slug, so a filer reads
 *   "send (StampSend, also Stamp)" rather than guessing from a bare slug.
 */
export function filingTypeOf(
  type: { slug: string; label: string; description?: string | null; schema: JsonSchema | null },
  references: Record<string, string[]> = {},
  names: Record<string, Record<string, string>> = {},
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
      const named = slugs.map(v => (names[to]?.[v] ? `${v} (${names[to][v]})` : v));
      prop.description = `${typeof prop.description === 'string' ? `${prop.description} ` : ''}One of this workspace's ${to} records, by slug: ${named.join(', ')}.`;
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
  const max = declared.title?.maxLength;
  const titleMax = typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : undefined;
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
    ...(titleMax ? { titleMax } : {}),
    ...(cfg.longTitleTo && properties[cfg.longTitleTo]?.type === 'string' ? { longTitleTo: cfg.longTitleTo } : {}),
    schema: type.schema ?? null,
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
  const said = spec.titleDescription ?? `One line naming this ${spec.label.toLowerCase()}.`;
  // The limit is told, not enforced: a longer title is not refused (that
  // would cost the person a retry) but named by a model (`nameLongTitle`).
  const limit = spec.titleMax ? ` At most ${spec.titleMax} characters.${spec.longTitleTo ? ` The whole ask goes in \`${spec.longTitleTo}\`, never in the title.` : ''}` : '';
  const shape: Record<string, z.ZodType> = {
    title: z.string().min(1).max(500).describe(`${said}${limit}`),
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
 * The objects.propose_candidate input a typed filing's arguments make: the
 * type's fields, its title, and the TYPE's identity — the one shape both the
 * tool and a card written from the tool's schema file (`cardBackstop.ts`).
 * @param spec - The filing type.
 * @param args - The tool's arguments.
 */
export function filingInputOf(spec: FilingType, args: Record<string, unknown>): { objectType: string; title: string; fields: Record<string, unknown>; dedupOn: string[] } {
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
  return { objectType: spec.slug, title, fields, dedupOn: spec.dedupOn };
}

/**
 * A TITLE LONGER THAN A NAME (Chris, 2026-10-03: "we need a better
 * ticket-sized name … not a full request or spec in the title"). The type
 * says how long a title may be (its title's `maxLength`); a filer that hands
 * over more is not refused — the person would pay a retry for it. The long
 * words are kept as the ask (`x-agent-file.longTitleTo`, when that field is
 * empty) and a model reads them into a ticket-sized name
 * (`services/objects/recordName.ts`). Never cut by a character count; a read
 * that fails files the title as it came.
 * @param orgId - The workspace.
 * @param spec - The filing type.
 * @param filing - What `filingInputOf` made of the arguments.
 * @param filing.title - The title as handed over.
 * @param filing.fields - The fields.
 * @param read - The model read; injected in tests.
 */
export async function nameLongTitle(
  orgId: string,
  spec: Pick<FilingType, 'slug' | 'label' | 'titleMax' | 'longTitleTo' | 'titleIsField' | 'dedupOn'>,
  filing: { title: string; fields: Record<string, unknown> },
  read?: (input: { orgId: string; text: string; kind?: string }) => Promise<string | null>,
): Promise<{ title: string; fields: Record<string, unknown>; named: boolean }> {
  const { title } = filing;
  if (!spec.titleMax || title.length <= spec.titleMax) {
    return { ...filing, named: false };
  }
  const readName = read ?? (await import('@/services/objects/recordName')).readRecordName;
  const name = await readName({ orgId, text: title, kind: spec.label.toLowerCase() });
  if (!name) {
    return { ...filing, named: false };
  }
  const fields = { ...filing.fields };
  const to = spec.longTitleTo;
  if (to && (typeof fields[to] !== 'string' || (fields[to] as string).trim() === '')) {
    fields[to] = title;
  }
  if (spec.titleIsField || spec.dedupOn.includes('title')) {
    fields.title = name;
  }
  return { title: name, fields, named: true };
}

/**
 * The one `readThisTurn` requirement a type's candidate-ready gate declares
 * (`gapCheck.sources`, naming the product's capabilities page), or undefined
 * for a type with none.
 * @param schema - The type's stored schema.
 */
function capabilitiesRequirement(schema: JsonSchema | null): GateRequirement | undefined {
  const gates = gatesOf(schema).filter(g => g.when.field === 'status' && (g.when.becomes ?? []).includes('candidate'));
  for (const gate of gates) {
    const found = gate.require.find(r => typeof r.readThisTurn?.includes === 'string');
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * A dotted path off a plain record (`gapCheck.sources`, `kind`) — the same
 * walk `libs/gates/handoffGate.ts`'s own (unexported) `get` does, needed here
 * to read a requirement's `if` condition and its own field before the gate
 * itself runs.
 * @param record - The record.
 * @param path - A dotted path.
 */
function pathValue(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), record);
}

/**
 * Read a wiki page on the model's behalf and record it exactly as
 * `read_wiki_page` would: on `ctx.turnReads` for the rest of this in-process
 * turn, and as a `tool_call` row so a later, separate call (a different
 * turn, the same conversation) still finds it — the same two readers
 * `services/gates/turnReads.ts#readsThisTurn` already checks.
 * @param ctx - The turn.
 * @param page - The page read.
 */
async function recordCapabilitiesRead(ctx: RuntimeContext, page: WikiPage): Promise<void> {
  const output = renderWikiPageBody(page);
  noteTurnRead(ctx, 'read_wiki_page', { slug: page.slug }, output);
  await persistToolCall({
    ctx,
    tool: 'read_wiki_page',
    // `via` marks the row as file_request's own read, not the model's — it
    // is not part of the read's identity (readKeyOf reads `output`/`slug`
    // alone), only a trail for anyone reading the tool_call log later.
    input: { slug: page.slug, via: 'file_request' },
    output,
    durationMs: 0,
    ns: '',
  });
}

/**
 * Whether a gap or an idea (or whatever a type's own `readThisTurn`
 * requirement gates on) has already named the target page among its
 * sources, checking it against the type's OWN sources field. `undefined`
 * files as normal — no such requirement, this filing's kind does not trigger
 * it, or the target already resolves and is already cited. A non-undefined
 * return is the answer to send instead of filing: what the product already
 * ships, in the page's own words, and what to call again with.
 * @param ctx - The turn.
 * @param spec - The filing type.
 * @param fields - The fields as they will be filed.
 */
async function capabilitiesToCheck(ctx: RuntimeContext, spec: FilingType, fields: Record<string, unknown>): Promise<{ recordTitle: string; pageRef: string; excerpt: string } | undefined> {
  const req = capabilitiesRequirement(spec.schema);
  const includes = req?.readThisTurn?.includes;
  if (!req || !includes) {
    return undefined;
  }
  const merged = { ...fields, status: 'candidate' };
  if (req.if) {
    const v = pathValue(merged, req.if.field);
    if (!(typeof v === 'string' && req.if.oneOf.includes(v))) {
      return undefined; // this filing's kind does not ask the question
    }
  }
  const target = await resolveIncludeTarget(ctx.orgId, spec.schema, includes, merged);
  if (!target) {
    return undefined; // no product, or it names no capabilities page — the ordinary gate asks only for sources
  }
  const pageRef = `wiki:${target.wiki.slug}`;
  const pageKeys = [pageRef, `artifact:${target.wiki.id}`];
  if (!(await readsThisTurn(ctx)).some(k => pageKeys.includes(k))) {
    await recordCapabilitiesRead(ctx, target.wiki);
  }
  const sourcesVal = pathValue(merged, req.field);
  const sources = Array.isArray(sourcesVal) ? sourcesVal.filter((s): s is string => typeof s === 'string') : [];
  if (sources.some(s => pageKeys.includes(sourceKey(s)))) {
    return undefined; // already names the page — let the gate's own re-check pass it through
  }
  return { recordTitle: target.recordTitle, pageRef, excerpt: target.wiki.md.trim().slice(0, 4000) };
}

/**
 * ONE RUN, ONE FILING (#234, 2026-09-29): a planning run for #130, whose job
 * was `file_architecture_plan`, filed a new request duplicating #130 instead.
 * When the automation that started this run requires one typed filing, any
 * other `file_*` filing in the run is refused and named.
 * @param ctx - The turn.
 * @param toolName - The filing tool being called.
 * @returns The refusal, or undefined when the filing is this run's job (or the run has none).
 */
export async function wrongFilingForRun(ctx: RuntimeContext, toolName: string): Promise<string | undefined> {
  if (!ctx.missionRunId) {
    return undefined;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationSchema, missionRunSchema } = await import('@/models/Schema');
  const [run] = await db.select({ causedBy: missionRunSchema.causedBy }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, ctx.orgId), eq(missionRunSchema.id, ctx.missionRunId))).limit(1);
  const slug = (run?.causedBy as Array<{ automationSlug?: string }> | null | undefined)?.[0]?.automationSlug;
  if (!slug) {
    return undefined;
  }
  const [auto] = await db.select({ doConfig: automationSchema.doConfig }).from(automationSchema).where(and(eq(automationSchema.orgId, ctx.orgId), eq(automationSchema.slug, slug))).limit(1);
  const required = String((auto?.doConfig as { requireTool?: unknown } | null | undefined)?.requireTool ?? '').split(':')[0] ?? '';
  if (!required.startsWith('file_') || required === toolName) {
    return undefined;
  }
  return `Not filed: this run ("${slug}") exists to call ${required}, and ${toolName} files a different record. File what this run is for with ${required}; if you found separate work, say so in your report and a person decides.`;
}

/** The filings told, this turn, that the person meant another record: told once, then filed as written. */
const toldThisTurn = new WeakMap<RuntimeContext, Set<string>>();

/**
 * BORN UNDER THE RIGHT RECORD (2026-10-01, run 2). FE-294 and FE-298 were
 * filed under Slate when the person said "Stamp's document page"; the read
 * after filing moved the product, but the story stayed "shared via Slate".
 * So before the record is written, the type's reference read
 * (`x-reference-read`, `services/objects/referenceRead.ts`) reads the person's
 * words against the records the field can name. When it confidently names
 * another one, nothing is filed yet and the filer is told which, with the
 * person's words, so it writes the record (title and story included) for the
 * right one. Told once per turn: a second call files as written, and the read
 * after filing stays the backstop. The filer's words are never edited.
 * @param ctx - The turn.
 * @param spec - The filing type.
 * @param fields - The fields as they will be filed.
 * @returns What to tell the filer, or undefined to file.
 */
async function referenceToCorrect(ctx: RuntimeContext, spec: FilingType, fields: Record<string, unknown>): Promise<string | undefined> {
  const told = toldThisTurn.get(ctx) ?? new Set<string>();
  if (told.has(spec.toolName)) {
    return undefined;
  }
  const read = await readBeforeFiling(ctx.orgId, { schema: spec.schema, fields, conversationId: ctx.conversationId });
  if (!read) {
    return undefined;
  }
  told.add(spec.toolName);
  toldThisTurn.set(ctx, told);
  const from = read.from ? ` not ${read.fromTitle ?? read.from} (${read.from}),` : '';
  const said = read.quote ? ` They said: "${read.quote}".` : '';
  return `Not filed yet: the person's words name ${read.toTitle} (${read.field}: ${read.to}),${from} as the one this is for.${said} Call ${spec.toolName} again with ${read.field}: ${read.to}, and write the title and story for ${read.toTitle}. If you are sure they meant another, call it again as it was and it is filed.`;
}

/**
 * THE ASKER IS THE PERSON ON THE TURN (Chris, 2026-10-05: three share cards read "Chris · 4 Oct"
 * for asks the QA account had made; the model had written the workspace's owner). When the type
 * keeps who asked and a person is on this turn, it is their name and email as the account holds
 * them, never the model's guess; what the model knew that the account does not (their id on a
 * channel) is kept. A turn with nobody on it — a schedule, a mission, a relayed message — files
 * what the model read.
 * @param ctx - The turn.
 * @param spec - The filing type.
 * @param fields - The fields as the model gave them.
 */
async function askedByPerson(ctx: RuntimeContext, spec: FilingType, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!('askedBy' in spec.properties) || !ctx.userId || ctx.missionRunId) {
    return fields;
  }
  const { getProfile } = await import('@/services/UserProfileService');
  const who = await getProfile(ctx.userId).catch(() => null);
  if (!who?.email) {
    return fields;
  }
  const given = fields.askedBy && typeof fields.askedBy === 'object' && !Array.isArray(fields.askedBy) ? fields.askedBy as Record<string, unknown> : {};
  return { ...fields, askedBy: { ...given, name: who.name?.trim() || who.email, email: who.email, userId: ctx.userId } };
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
      const offJob = await wrongFilingForRun(ctx, spec.toolName).catch(() => undefined);
      if (offJob) {
        return offJob;
      }
      const { title, fields: named } = await nameLongTitle(ctx.orgId, spec, filingInputOf(spec, args));
      const fields = await askedByPerson(ctx, spec, named);
      const meant = await referenceToCorrect(ctx, spec, fields);
      if (meant) {
        return meant;
      }
      const toCheck = await capabilitiesToCheck(ctx, spec, fields);
      // On the person's word it files anyway, and what already ships goes
      // back as advice on the filed record (`filingOnPersonsWord`).
      const onPersonsWord = toCheck ? await filingOnPersonsWord(ctx) : false;
      if (toCheck && !onPersonsWord) {
        return `Not filed yet: here is what ${toCheck.recordTitle} already ships (from ${toCheck.pageRef}): ${toCheck.excerpt}\n\nDecide gapCheck.finding (add | modify | none) against it and call ${spec.toolName} again with gapCheck.sources ["${toCheck.pageRef}"].`;
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
        ...(toCheck && onPersonsWord ? { advice: [`${toCheck.recordTitle}'s capabilities page (${toCheck.pageRef}) was not checked yet; it says: ${toCheck.excerpt.slice(0, 1_200)}`] } : {}),
      });
    },
    {
      name: spec.toolName,
      description: `File one ${label} record. Use this — not propose_action — whenever a ${label} is to be filed: the arguments ARE the ${label}'s fields, with the ones it must carry marked required (${required.join(', ')}). Transcribe what the person asked for; write what the thread settled; never ask them to restate it. Identity (dedup) is set for you. Filed done-for-you within the workspace's trust bar; the answer names the record and its link, which is what you tell the person.${spec.description ? ` About a ${label}: ${spec.description.slice(0, 600)}` : ''}`,
      schema: filingSchema(spec),
    },
  );
  return built;
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
  const describe = [...new Set(opted.flatMap(r => referenceReadOf(r.schema)?.describe ?? []))];
  const { slugs, names } = await recordSlugsByType(orgId, [...new Set(opted.flatMap(r => referenceTypesOf(r.schema)))], describe);
  return opted.map(r => filingTypeOf(r, slugs, names)).filter((t): t is FilingType => t !== null);
}

/**
 * The slugs (`metadata.slug`) of the live records of each type — the values
 * a reference field may take. Candidates and rejected records are not yet,
 * or no longer, things a record can belong to.
 * @param orgId - The workspace.
 * @param typeSlugs - The referenced types.
 * @param describe - The fields that name a record (its type's reference read describes it by), beside its title.
 */
async function recordSlugsByType(orgId: string, typeSlugs: string[], describe: string[] = []): Promise<{ slugs: Record<string, string[]>; names: Record<string, Record<string, string>> }> {
  if (typeSlugs.length === 0) {
    return { slugs: {}, names: {} };
  }
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ type: businessObjectTypeSchema.slug, slug: sql<string | null>`${businessObjectSchema.metadata}->>'slug'`, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      inArray(businessObjectTypeSchema.slug, typeSlugs),
      sql`coalesce(${businessObjectSchema.status}, 'active') not in ('candidate', 'rejected', 'archived')`,
    ))
    .limit(1000);
  const out: Record<string, string[]> = {};
  const names: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    if (typeof row.slug === 'string' && row.slug.trim()) {
      const list = (out[row.type] ??= []);
      if (!list.includes(row.slug)) {
        list.push(row.slug);
        const called = namesOf(row.slug, row.title, (row.metadata ?? {}) as Record<string, unknown>, describe);
        if (called) {
          (names[row.type] ??= {})[row.slug] = called;
        }
      }
    }
  }
  for (const list of Object.values(out)) {
    list.sort();
  }
  return { slugs: out, names };
}

/** A name longer than this is a description, not something a person calls it. */
const MAX_NAME = 60;

/**
 * What a record is called, beside its slug: its title, then the short names
 * its type's reference read describes it by (aliases, a working name),
 * each once. Null when it is called only its slug.
 * @param slug - The record's slug.
 * @param title - Its title.
 * @param meta - Its fields.
 * @param describe - The fields that name it.
 */
export function namesOf(slug: string, title: string, meta: Record<string, unknown>, describe: readonly string[]): string | null {
  const seen = new Set([slug.toLowerCase()]);
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && v.trim().length <= MAX_NAME && !seen.has(v.trim().toLowerCase())) {
      seen.add(v.trim().toLowerCase());
      out.push(v.trim());
    }
  };
  add(title);
  for (const field of describe) {
    const v = meta[field];
    (Array.isArray(v) ? v : [v]).forEach(add);
  }
  if (out.length === 0) {
    return null;
  }
  const [first, ...rest] = out;
  return rest.length > 0 ? `${first}, also ${rest.join(', ')}` : first!;
}
