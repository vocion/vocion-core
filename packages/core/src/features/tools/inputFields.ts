/**
 * A tool's arguments as rows a person can read — the JSON Schema the model
 * sees (`buildToolCatalog`, or a REST endpoint's declared `input`) reduced
 * to name, type, required and description. Pure, so the Tools page and a
 * tool's own page render the same table from the same schema.
 */

/** One argument of a tool, as the parameter table shows it. */
export type InputField = {
  name: string;
  /** `string`, `number`, `"a" | "b"`, `string[]`, `string (date)`… */
  type: string;
  required: boolean;
  description: string;
};

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The type of one property, in the words the built-in catalog uses.
 * @param prop - A JSON Schema property.
 */
export function fieldType(prop: unknown): string {
  if (!isRecord(prop)) {
    return 'any';
  }
  if (Array.isArray(prop.enum)) {
    return prop.enum.map(v => JSON.stringify(v)).join(' | ');
  }
  if (Array.isArray(prop.const)) {
    return JSON.stringify(prop.const);
  }
  const variants = [prop.anyOf, prop.oneOf].find(Array.isArray);
  if (variants) {
    const types = [...new Set(variants.map(fieldType))];
    return types.join(' | ');
  }
  const type = Array.isArray(prop.type) ? prop.type.map(String).join(' | ') : typeof prop.type === 'string' ? prop.type : undefined;
  if (type === 'array') {
    return `${fieldType(prop.items)}[]`;
  }
  if (type === 'object') {
    return 'object';
  }
  if (!type) {
    return 'any';
  }
  return typeof prop.format === 'string' ? `${type} (${prop.format})` : type;
}

/**
 * The rows of a tool's parameter table, in the schema's own order.
 * @param schema - An object JSON Schema; anything else yields no rows.
 */
export function fieldsFromInputSchema(schema: unknown): InputField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: fieldType(prop),
    required: required.has(name),
    description: isRecord(prop) && typeof prop.description === 'string' ? prop.description : '',
  }));
}
