import { describe, expect, it } from 'vitest';
import { fieldsFromInputSchema, fieldType } from './inputFields';

describe('fieldsFromInputSchema', () => {
  it('reads a tool\'s JSON Schema as rows, required marked, in the schema\'s order', () => {
    const rows = fieldsFromInputSchema({
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The project' },
        status: { type: 'string', enum: ['active', 'archived'] },
        tags: { type: 'array', items: { type: 'string' } },
        since: { type: 'string', format: 'date' },
        count: { type: ['number', 'null'] },
        any: {},
      },
      required: ['documentId'],
    });

    expect(rows).toEqual([
      { name: 'documentId', type: 'string', required: true, description: 'The project' },
      { name: 'status', type: '"active" | "archived"', required: false, description: '' },
      { name: 'tags', type: 'string[]', required: false, description: '' },
      { name: 'since', type: 'string (date)', required: false, description: '' },
      { name: 'count', type: 'number | null', required: false, description: '' },
      { name: 'any', type: 'any', required: false, description: '' },
    ]);
  });

  it('reads the union a zod-derived schema writes, and answers nothing for a schema with no properties', () => {
    expect(fieldType({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number');
    expect(fieldType({ type: 'object', properties: {} })).toBe('object');
    expect(fieldsFromInputSchema({ type: 'object' })).toEqual([]);
    expect(fieldsFromInputSchema(null)).toEqual([]);
    expect(fieldsFromInputSchema('nope')).toEqual([]);
  });
});
