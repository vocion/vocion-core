/**
 * The JSON Schema subset an endpoint's input may use: what is refused, with
 * the property named, and what the accepted schema becomes as zod — a schema
 * that validates the model's arguments and converts back to JSON Schema for
 * every provider with no transform in it.
 */
import type { InputSchema } from './jsonSchema';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it } from 'vitest';
import { inputPropertyNames, inputSchemaProblems, normalizeInput, zodFromInputSchema } from './jsonSchema';

const GOOD: InputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['active', 'archived'], description: 'Project status' },
    search: { type: 'string', description: 'Substring of the name' },
    limit: { type: 'integer' },
    ratio: { type: 'number' },
    archived: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    dueDate: { type: 'string', format: 'date' },
    at: { type: 'string', format: 'date-time' },
    email: { type: 'string', format: 'email' },
    link: { type: 'string', format: 'uri' },
  },
  required: ['status'],
};

describe('inputSchemaProblems', () => {
  it('accepts the whole subset', () => {
    expect(inputSchemaProblems(GOOD)).toEqual([]);
    expect(inputSchemaProblems({ type: 'object' })).toEqual([]);
  });

  it('names every fault, one per line, with the property it is on', () => {
    const problems = inputSchemaProblems({
      type: 'object',
      properties: {
        'owner': { type: 'object', properties: { id: { type: 'string' } } },
        'size': { type: 'string', minLength: 3 },
        'kind': { type: 'string', format: 'uuid' },
        'matrix': { type: 'array', items: { type: 'array' } },
        'flags': { type: 'array' },
        'count': { type: 'integer', enum: ['1'] },
        'bad-name': { type: 'string' },
      },
      required: ['missing'],
      additionalProperties: false,
    });

    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('input.owner: nested objects are not supported'),
      expect.stringContaining('input.size: "minLength" is not supported'),
      expect.stringContaining('input.kind: format must be one of date, date-time, email, uri'),
      expect.stringContaining('input.matrix.items: type must be one of string, number, integer, boolean'),
      expect.stringContaining('input.flags: an array property needs items'),
      expect.stringContaining('input.count: enum is only supported on a string property'),
      expect.stringContaining('input.bad-name: property names must be'),
      expect.stringContaining('input.required: names "missing"'),
      expect.stringContaining('input: "additionalProperties" is not supported here'),
    ]));
  });

  it('refuses a non-object and a wrong top-level type', () => {
    expect(inputSchemaProblems('nope')).toEqual([expect.stringContaining('must be an object schema')]);
    expect(inputSchemaProblems({ type: 'array' })).toEqual([expect.stringContaining('type must be "object"')]);
  });
});

describe('zodFromInputSchema', () => {
  const schema = zodFromInputSchema(GOOD);

  it('validates the model\'s arguments: enums, integers, formats, required', () => {
    expect(schema.safeParse({ status: 'active', limit: 5, dueDate: '2026-10-01', at: '2026-10-01T09:00:00Z', email: 'ops@northwind.example', link: 'https://northwind.example/x', tags: ['a'] }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(schema.safeParse({ status: 'active', limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ status: 'active', dueDate: 'next tuesday' }).success).toBe(false);
    expect(schema.safeParse({ status: 'active', tags: 'a' }).success).toBe(false);
  });

  it('carries descriptions and optionality into JSON Schema, with no transform to trip a provider', () => {
    const json = toJsonSchema(schema as never) as { properties: Record<string, { description?: string; enum?: string[] }>; required?: string[] };

    expect(json.properties.status!.enum).toEqual(['active', 'archived']);
    expect(json.properties.status!.description).toBe('Project status');
    expect(json.required).toEqual(['status']);
  });

  it('lists the declared property names in order', () => {
    expect(inputPropertyNames(GOOD)).toEqual(['status', 'search', 'limit', 'ratio', 'archived', 'tags', 'dueDate', 'at', 'email', 'link']);
  });
});

describe('list constraints — pattern, normalize, maxItems, uniqueItems', () => {
  const KEYS: InputSchema = {
    type: 'object',
    properties: {
      keys: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', normalize: ['trim', 'uppercase'], pattern: '^[A-Z][A-Z0-9_]+-[1-9]\\d*$' } },
      code: { type: 'string', normalize: ['trim', 'lowercase'] },
    },
  };

  it('are accepted where they belong and named where they do not', () => {
    expect(inputSchemaProblems(KEYS)).toEqual([]);
    expect(inputSchemaProblems({
      type: 'object',
      properties: {
        a: { type: 'array', pattern: 'x', items: { type: 'string' } },
        b: { type: 'array', maxItems: 0, uniqueItems: 'yes', items: { type: 'string' } },
        c: { type: 'string', maxItems: 2 },
        d: { type: 'integer', pattern: 'x', normalize: ['trim'] },
        e: { type: 'string', pattern: '(' },
        f: { type: 'string', normalize: ['shout'] },
      },
    })).toEqual([
      'input.a: enum, format, pattern and normalize go on the array\'s items, not on the array',
      'input.b: maxItems must be a whole number of at least 1',
      'input.b: uniqueItems must be true or false',
      'input.c: maxItems and uniqueItems go on an array property',
      'input.d: pattern is only supported on a string property',
      'input.d: normalize is only supported on a string property',
      expect.stringMatching(/^input\.e: pattern is not a valid regular expression/),
      'input.f: normalize must be a list of trim, uppercase, lowercase',
    ]);
  });

  it('normalize trims, cases and dedupes before anything is checked, leaving what it does not own alone', () => {
    expect(normalizeInput(KEYS, { keys: [' acme-1', 'ACME-1 ', 'acme-22'], code: '  AbC ', other: ' x ' })).toEqual({ keys: ['ACME-1', 'ACME-22'], code: 'abc', other: ' x ' });
    expect(normalizeInput(KEYS, { keys: [] })).toEqual({ keys: [] });
    expect(normalizeInput(KEYS, { keys: 'ACME-1' })).toEqual({ keys: 'ACME-1' });
  });

  it('are enforced when a write is validated, and left out of the schema a model is bound with', () => {
    const enforced = zodFromInputSchema(KEYS, { enforce: true });

    expect(enforced.safeParse({ keys: ['ACME-1', 'ACME-2', 'ACME-3'] }).success).toBe(true);
    expect(enforced.safeParse({ keys: [] }).success).toBe(true);

    const tooMany = enforced.safeParse({ keys: ['AB-1', 'BC-1', 'CD-1', 'DE-1'] });

    expect(tooMany.success).toBe(false);
    expect(tooMany.error!.issues[0]!.message).toBe('at most 3 entries');

    const badKey = enforced.safeParse({ keys: ['ACME-1', 'acme 12'] });

    expect(badKey.success).toBe(false);
    expect(badKey.error!.issues[0]!.path).toEqual(['keys', 1]);
    expect(badKey.error!.issues[0]!.message).toBe('"acme 12" does not match ^[A-Z][A-Z0-9_]+-[1-9]\\d*$');

    const bound = zodFromInputSchema(KEYS);

    expect(bound.safeParse({ keys: ['anything', 'goes', 'here', 'too'] }).success).toBe(true);
  });
});
