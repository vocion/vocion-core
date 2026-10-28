/**
 * The JSON Schema subset a `rest` source may declare for an endpoint's input,
 * and its translation into plain zod.
 *
 * Two halves, kept apart on purpose. `inputSchemaProblems` is what the
 * workspace apply runs: it walks a declared schema and says, one line per
 * fault, what falls outside the subset — so a typo in `sources/<slug>.yaml`
 * fails `workspace:check` naming the property, rather than an agent turn
 * weeks later. `zodFromInputSchema` runs at graph build over schemas the apply
 * already accepted and produces the zod object a LangChain `tool()` is bound
 * with.
 *
 * The subset is deliberately small: an object of string / number / integer /
 * boolean / enum / array-of-primitive properties, with `required`,
 * `description` and four string formats. A string may also carry a `pattern`
 * and a `normalize` list (`trim`, `uppercase`, `lowercase`), and an array a
 * `maxItems` and `uniqueItems` — the constraints a list of identifiers needs
 * (a set of ticket keys: trimmed, upper-cased, deduped, capped, each matching
 * the key format). `normalizeInput` applies the normalizing half before a
 * write is validated; `zodFromInputSchema(schema, { enforce: true })` checks
 * the rest. The schema a model is bound with leaves them out, so a provider
 * that does not take `pattern` is never handed one. That is what a REST endpoint's
 * arguments look like in practice, and it is also exactly what converts to
 * every provider's tool schema with no transform in it
 * (`services/agents/tools/registry.schema.test.ts` walks every tool for that).
 * Nested objects are refused rather than half-supported: an endpoint that
 * takes one belongs behind a `body` template, whose keys the model fills in
 * one flat argument each.
 */

import { z } from 'zod';

/** The property types the subset accepts. */
const PRIMITIVE_TYPES = ['string', 'number', 'integer', 'boolean'] as const;

/** String formats the subset accepts, each mapped to a zod check in `zodFromInputSchema`. */
const STRING_FORMATS = ['date', 'date-time', 'email', 'uri'] as const;

/** Keywords a property may carry. Anything else is a typo or outside the subset, and is named. */
const PROPERTY_KEYWORDS = new Set(['type', 'description', 'enum', 'format', 'items', 'pattern', 'normalize', 'maxItems', 'uniqueItems']);

/** What `normalize` may ask of a string, applied in this order of declaration. */
const NORMALIZE_STEPS = ['trim', 'uppercase', 'lowercase'] as const;
export type NormalizeStep = (typeof NORMALIZE_STEPS)[number];

/** Keywords the top-level object may carry. */
const OBJECT_KEYWORDS = new Set(['type', 'properties', 'required', 'description']);

type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

/** One primitive property, or the items of an array property. */
export type PrimitiveSchema = {
  type: PrimitiveType;
  description?: string;
  enum?: string[];
  format?: (typeof STRING_FORMATS)[number];
  /** A regular expression the whole string must match (anchor it yourself: `^…$`). Checked after `normalize`. */
  pattern?: string;
  /** What is done to the string before it is checked or sent. */
  normalize?: NormalizeStep[];
};

/** An array property. */
export type ArrayPropertySchema = {
  type: 'array';
  description?: string;
  items: PrimitiveSchema;
  /** The longest list accepted, counted after duplicates are dropped. */
  maxItems?: number;
  /** Repeats are dropped (after `normalize`), first one kept — the list is a set. */
  uniqueItems?: boolean;
};

/** One declared property: a primitive, or an array of one. */
export type PropertySchema = PrimitiveSchema | ArrayPropertySchema;

/** An endpoint's input as the subset spells it. */
export type InputSchema = {
  type: 'object';
  description?: string;
  properties?: Record<string, PropertySchema>;
  required?: string[];
};

/** The empty input — an endpoint that takes no arguments. */
export const EMPTY_INPUT_SCHEMA: InputSchema = { type: 'object', properties: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The faults in one primitive property (or an array's `items`), each a
 * sentence naming where it is.
 * @param prop - The property as declared.
 * @param at - Where it is, for the message (`input.status`).
 * @param problems - Accumulator.
 * @param inArray - Whether this is an array's `items`, where `items` itself is not allowed again.
 */
function primitiveProblems(prop: Record<string, unknown>, at: string, problems: string[], inArray: boolean): void {
  const type = prop.type;
  if (typeof type !== 'string' || !(PRIMITIVE_TYPES as readonly string[]).includes(type)) {
    problems.push(`${at}: type must be one of ${PRIMITIVE_TYPES.join(', ')}${inArray ? '' : ', array'}; got ${JSON.stringify(type)}`);
    return;
  }
  if (prop.enum !== undefined) {
    if (type !== 'string') {
      problems.push(`${at}: enum is only supported on a string property`);
    } else if (!Array.isArray(prop.enum) || prop.enum.length === 0 || !prop.enum.every(v => typeof v === 'string')) {
      problems.push(`${at}: enum must be a non-empty list of strings`);
    }
  }
  if (prop.format !== undefined) {
    if (type !== 'string') {
      problems.push(`${at}: format is only supported on a string property`);
    } else if (typeof prop.format !== 'string' || !(STRING_FORMATS as readonly string[]).includes(prop.format)) {
      problems.push(`${at}: format must be one of ${STRING_FORMATS.join(', ')}; got ${JSON.stringify(prop.format)}`);
    }
  }
  if (prop.pattern !== undefined) {
    if (type !== 'string') {
      problems.push(`${at}: pattern is only supported on a string property`);
    } else if (typeof prop.pattern !== 'string') {
      problems.push(`${at}: pattern must be a regular expression, as a string`);
    } else {
      try {
        void new RegExp(prop.pattern);
      } catch (error) {
        problems.push(`${at}: pattern is not a valid regular expression — ${(error as Error).message}`);
      }
    }
  }
  if (prop.normalize !== undefined) {
    if (type !== 'string') {
      problems.push(`${at}: normalize is only supported on a string property`);
    } else if (!Array.isArray(prop.normalize) || !prop.normalize.every(step => (NORMALIZE_STEPS as readonly unknown[]).includes(step))) {
      problems.push(`${at}: normalize must be a list of ${NORMALIZE_STEPS.join(', ')}`);
    }
  }
  if (prop.maxItems !== undefined || prop.uniqueItems !== undefined) {
    problems.push(`${at}: maxItems and uniqueItems go on an array property`);
  }
  if (inArray && prop.items !== undefined) {
    problems.push(`${at}: an array of arrays is not supported`);
  }
}

/**
 * Every way a declared input schema falls outside the subset, as sentences a
 * person fixes the YAML from. Empty means `zodFromInputSchema` will accept it.
 * @param schema - The `input` block as declared, of any shape.
 * @param at - Where it is, for the message. Defaults to `input`.
 */
export function inputSchemaProblems(schema: unknown, at = 'input'): string[] {
  const problems: string[] = [];
  if (!isRecord(schema)) {
    return [`${at}: must be an object schema ({ type: object, properties: {…} })`];
  }
  if (schema.type !== 'object') {
    problems.push(`${at}: type must be "object"`);
  }
  for (const key of Object.keys(schema)) {
    if (!OBJECT_KEYWORDS.has(key)) {
      problems.push(`${at}: "${key}" is not supported here (allowed: ${[...OBJECT_KEYWORDS].join(', ')})`);
    }
  }
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) {
    problems.push(`${at}.properties: must be an object of property schemas`);
    return problems;
  }
  for (const [name, raw] of Object.entries(properties)) {
    const here = `${at}.${name}`;
    if (!/^[a-z_]\w*$/i.test(name)) {
      problems.push(`${here}: property names must be letters, digits and underscores, starting with a letter`);
    }
    if (!isRecord(raw)) {
      problems.push(`${here}: must be a property schema ({ type: string, … })`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!PROPERTY_KEYWORDS.has(key)) {
        problems.push(`${here}: "${key}" is not supported (allowed: ${[...PROPERTY_KEYWORDS].join(', ')})`);
      }
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      problems.push(`${here}: description must be a string`);
    }
    if (raw.type === 'array') {
      if (!isRecord(raw.items)) {
        problems.push(`${here}: an array property needs items ({ type: string })`);
      } else {
        primitiveProblems(raw.items, `${here}.items`, problems, true);
      }
      if (raw.enum !== undefined || raw.format !== undefined || raw.pattern !== undefined || raw.normalize !== undefined) {
        problems.push(`${here}: enum, format, pattern and normalize go on the array's items, not on the array`);
      }
      if (raw.maxItems !== undefined && (typeof raw.maxItems !== 'number' || !Number.isInteger(raw.maxItems) || raw.maxItems < 1)) {
        problems.push(`${here}: maxItems must be a whole number of at least 1`);
      }
      if (raw.uniqueItems !== undefined && typeof raw.uniqueItems !== 'boolean') {
        problems.push(`${here}: uniqueItems must be true or false`);
      }
      continue;
    }
    if (raw.type === 'object') {
      problems.push(`${here}: nested objects are not supported — take the fields as flat arguments and shape them in the endpoint's body template`);
      continue;
    }
    primitiveProblems(raw, here, problems, false);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every(r => typeof r === 'string')) {
      problems.push(`${at}.required: must be a list of property names`);
    } else {
      for (const name of schema.required) {
        if (!(name in properties)) {
          problems.push(`${at}.required: names "${name}", which is not a declared property`);
        }
      }
    }
  }
  return problems;
}

/**
 * The declared property names, in declared order. Empty for a schema with none.
 * @param schema - An accepted input schema.
 */
export function inputPropertyNames(schema: InputSchema): string[] {
  return Object.keys(schema.properties ?? {});
}

/**
 * One primitive as plain zod.
 * @param prop - An accepted primitive schema.
 * @param enforce - Whether `pattern` is checked (validation), or left out (a model's tool schema).
 */
function zodPrimitive(prop: PrimitiveSchema, enforce: boolean): z.ZodType {
  if (prop.enum && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop.type) {
    case 'string': {
      let str: z.ZodType<string>;
      switch (prop.format) {
        case 'date':
          str = z.iso.date();
          break;
        case 'date-time':
          str = z.iso.datetime({ offset: true });
          break;
        case 'email':
          str = z.email();
          break;
        case 'uri':
          str = z.url();
          break;
        default:
          str = z.string();
      }
      if (enforce && prop.pattern !== undefined) {
        const pattern = new RegExp(prop.pattern);
        return str.refine((value: string) => pattern.test(value), {
          error: (issue: { input?: unknown }) => `${JSON.stringify(issue.input)} does not match ${prop.pattern}`,
        });
      }
      return str;
    }
    case 'integer':
      return z.number().int();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
  }
}

/**
 * An accepted input schema as the zod object a tool is bound with — types,
 * enums, formats, descriptions, optional where not required. No transforms,
 * so it converts back to JSON Schema for every provider.
 *
 * With `enforce`, also `pattern` and `maxItems` — the object a write's
 * arguments are validated with, after `normalizeInput`. Never bound to a
 * model: it carries refinements, which not every provider's schema takes.
 * @param schema - An input schema `inputSchemaProblems` found nothing wrong with.
 * @param opts - `enforce` adds the constraints a write is held to.
 * @param opts.enforce - Whether `pattern` and `maxItems` are checked.
 */
export function zodFromInputSchema(schema: InputSchema, opts: { enforce?: boolean } = {}): z.ZodObject<Record<string, z.ZodType>> {
  const enforce = opts.enforce === true;
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    let field: z.ZodType;
    if (prop.type === 'array') {
      let list = z.array(zodPrimitive(prop.items, enforce));
      if (enforce && prop.maxItems !== undefined) {
        list = list.max(prop.maxItems, { error: `at most ${prop.maxItems} entries` });
      }
      field = list;
    } else {
      field = zodPrimitive(prop, enforce);
    }
    if (prop.description) {
      field = field.describe(prop.description);
    }
    shape[name] = required.has(name) ? field : field.optional();
  }
  return z.object(shape);
}

/**
 * One string with its declared `normalize` steps applied. Anything that is
 * not a string is returned as it came, for the schema to refuse.
 * @param value - The argument.
 * @param steps - The declared steps, in order.
 */
function normalizeString(value: unknown, steps: readonly NormalizeStep[] | undefined): unknown {
  if (typeof value !== 'string' || !steps) {
    return value;
  }
  let out = value;
  for (const step of steps) {
    out = step === 'trim' ? out.trim() : step === 'uppercase' ? out.toUpperCase() : out.toLowerCase();
  }
  return out;
}

/**
 * A write's arguments with the schema's normalizing keywords applied — each
 * string's `normalize` steps, and an array's repeats dropped where it says
 * `uniqueItems`. Run before validation, so `pattern` and `maxItems` judge the
 * list that would be sent, and the card shows that same list. Undeclared and
 * ill-typed arguments pass through untouched for the schema to report.
 * @param schema - An accepted input schema.
 * @param raw - The arguments as proposed.
 */
export function normalizeInput(schema: InputSchema, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const value = raw[name];
    if (value === undefined || value === null) {
      continue;
    }
    if (prop.type === 'array') {
      if (!Array.isArray(value)) {
        continue;
      }
      const items = value.map(item => normalizeString(item, prop.items.normalize));
      out[name] = prop.uniqueItems ? items.filter((item, i) => items.findIndex(other => other === item) === i) : items;
    } else {
      out[name] = normalizeString(value, prop.normalize);
    }
  }
  return out;
}
