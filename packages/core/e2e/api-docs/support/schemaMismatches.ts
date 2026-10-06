/**
 * Where a real answer differs from the shape the OpenAPI document publishes
 * for it (#1196), so the e2e can hold every documented GET to its shape.
 *
 * It reads the subset of OpenAPI 3.0.3 schemas the generator writes: `type`,
 * `format: date-time`, `enum`, `nullable`, `properties`, `required`, `items`,
 * `additionalProperties` and `oneOf`. A `oneOf` is checked one level deep (the
 * member's type and required fields), which is enough to tell its shapes
 * apart. The walk keeps its own list of pending checks rather than recursing.
 */

/** A schema as the generator writes it. */
export type PublishedSchema = {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  format?: string;
  enum?: unknown[];
  nullable?: boolean;
  properties?: Record<string, PublishedSchema>;
  required?: string[];
  items?: PublishedSchema;
  additionalProperties?: PublishedSchema;
  oneOf?: PublishedSchema[];
};

/** One value still to check against its schema. */
type PendingCheck = { value: unknown; schema: PublishedSchema; path: string };

/**
 * Every place a value differs from a schema, as sentences naming the path.
 * Empty when it matches.
 * @param value - The parsed JSON answer.
 * @param schema - The schema the document publishes for it.
 */
export function schemaMismatches(value: unknown, schema: PublishedSchema): string[] {
  const problems: string[] = [];
  const pending: PendingCheck[] = [{ value, schema, path: '$' }];
  while (pending.length > 0) {
    const check = pending.pop()!;
    const problem = mismatchAt(check, pending);
    if (problem) {
      problems.push(problem);
    }
  }
  return problems;
}

/**
 * Check one value, queueing the values inside it. Returns the problem, if any.
 * @param check - The value, its schema and where it sits.
 * @param pending - Where to queue the values inside it.
 */
function mismatchAt(check: PendingCheck, pending: PendingCheck[]): string | null {
  const { value, schema, path } = check;
  if (value === null) {
    return schema.nullable || isAnyValue(schema) ? null : `${path} is null, which the document does not allow`;
  }
  if (schema.oneOf) {
    return schema.oneOf.some(member => shallowlyMatches(value, member)) ? null : `${path} matches none of the shapes the document offers`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${path} is ${JSON.stringify(value)}, not one of ${JSON.stringify(schema.enum)}`;
  }
  const typeProblem = typeMismatch(value, schema, path);
  if (typeProblem) {
    return typeProblem;
  }
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      pending.push({ value: item, schema: schema.items, path: `${path}[${index}]` });
    }
  }
  if (schema.type === 'object') {
    return objectMismatch(value as Record<string, unknown>, schema, path, pending);
  }
  return null;
}

/**
 * Whether a value is of the schema's `type`, and a date-time string parses.
 * Returns the problem, if any.
 * @param value - A value that is not null.
 * @param schema - Its schema.
 * @param path - Where it sits.
 */
function typeMismatch(value: unknown, schema: PublishedSchema, path: string): string | null {
  if (!schema.type) {
    return null;
  }
  if (actualType(value) !== schema.type) {
    return `${path} is ${actualType(value)}, but the document says ${schema.type}`;
  }
  if (schema.format === 'date-time' && Number.isNaN(Date.parse(value as string))) {
    return `${path} is ${JSON.stringify(value)}, not a date-time`;
  }
  return null;
}

/**
 * Check an object's required fields, and queue its fields' values.
 * @param value - The object.
 * @param schema - Its schema.
 * @param path - Where it sits.
 * @param pending - Where to queue its fields.
 */
function objectMismatch(value: Record<string, unknown>, schema: PublishedSchema, path: string, pending: PendingCheck[]): string | null {
  const missing = (schema.required ?? []).filter(name => !(name in value));
  for (const [name, fieldValue] of Object.entries(value)) {
    const fieldSchema = schema.properties?.[name] ?? schema.additionalProperties;
    if (fieldSchema) {
      pending.push({ value: fieldValue, schema: fieldSchema, path: `${path}.${name}` });
    }
  }
  return missing.length > 0 ? `${path} is missing ${missing.join(', ')}, which the document says are always there` : null;
}

/**
 * Whether a value fits a `oneOf` member at its top level: its type, and its
 * required fields when it is an object.
 * @param value - A value that is not null.
 * @param member - One of the shapes offered.
 */
function shallowlyMatches(value: unknown, member: PublishedSchema): boolean {
  if (member.type && actualType(value) !== member.type) {
    return false;
  }
  if (member.enum && !member.enum.includes(value)) {
    return false;
  }
  return (member.required ?? []).every(name => typeof value === 'object' && value !== null && name in value);
}

/**
 * The schema `type` a JSON value has.
 * @param value - A parsed JSON value that is not null.
 */
function actualType(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}

/**
 * Whether a schema allows any value: `{}`, as the generator writes for `any`.
 * @param schema - The schema.
 */
function isAnyValue(schema: PublishedSchema): boolean {
  return Object.keys(schema).length === 0;
}
