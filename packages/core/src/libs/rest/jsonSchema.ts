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
 * `description` and four string formats. That is what a REST endpoint's
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
const PROPERTY_KEYWORDS = new Set(['type', 'description', 'enum', 'format', 'items']);

/** Keywords the top-level object may carry. */
const OBJECT_KEYWORDS = new Set(['type', 'properties', 'required', 'description']);

type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

/** One primitive property, or the items of an array property. */
export type PrimitiveSchema = {
  type: PrimitiveType;
  description?: string;
  enum?: string[];
  format?: (typeof STRING_FORMATS)[number];
};

/** One declared property: a primitive, or an array of one. */
export type PropertySchema = PrimitiveSchema | {
  type: 'array';
  description?: string;
  items: PrimitiveSchema;
};

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
      if (raw.enum !== undefined || raw.format !== undefined) {
        problems.push(`${here}: enum and format go on the array's items, not on the array`);
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
 */
function zodPrimitive(prop: PrimitiveSchema): z.ZodType {
  if (prop.enum && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop.type) {
    case 'string':
      switch (prop.format) {
        case 'date':
          return z.iso.date();
        case 'date-time':
          return z.iso.datetime({ offset: true });
        case 'email':
          return z.email();
        case 'uri':
          return z.url();
        default:
          return z.string();
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
 * @param schema - An input schema `inputSchemaProblems` found nothing wrong with.
 */
export function zodFromInputSchema(schema: InputSchema): z.ZodObject<Record<string, z.ZodType>> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    let field: z.ZodType = prop.type === 'array' ? z.array(zodPrimitive(prop.items)) : zodPrimitive(prop);
    if (prop.description) {
      field = field.describe(prop.description);
    }
    shape[name] = required.has(name) ? field : field.optional();
  }
  return z.object(shape);
}
