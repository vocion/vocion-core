/**
 * The JSON schema of what a route answers, read from TypeScript's types (#1196).
 *
 * `parseRouteModule` reads a route's syntax, which tells it that a handler
 * calls `NextResponse.json(body)` but not what `body` looks like. Given the
 * type checker of a program that holds the route, this turns the type of
 * `body` into the schema of the JSON a client receives.
 *
 * The conversion follows what `JSON.stringify` writes, not what the type
 * says in memory:
 *
 * - a `Date` is a `date-time` string, and anything else with `toJSON` takes
 *   that method's return type;
 * - an optional property, or one that can be `undefined`, is not required,
 *   and `null` makes a schema `nullable` (OpenAPI 3.0.3 has no `null` type);
 * - string, number and boolean literals become `enum`;
 * - functions are dropped, as `JSON.stringify` drops them;
 * - `any` and `unknown` become `{}`, which allows any value.
 *
 * The walk uses an explicit list of pending work rather than recursion. A type
 * met again inside itself stops there as a plain object, and a body whose type
 * would take more than {@link MAX_TASKS} steps (an accidental library type)
 * gives up and reports no schema, rather than writing a document nobody can
 * read. Union members and enum values are sorted, so the document does not
 * churn when TypeScript numbers its types differently.
 */
import ts from 'typescript';

/** A JSON schema object, in the OpenAPI 3.0.3 dialect. */
export type JsonSchema = Record<string, unknown>;

/** Deeper than this, a value is described as any value. No answer nests this far on purpose. */
const MAX_DEPTH = 12;

/** The most types one body may take to describe before the walk gives up. */
const MAX_TASKS = 5000;

/** Types that `JSON.stringify` writes as `{}`, whatever they hold. */
const WRITTEN_AS_EMPTY_OBJECT = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

/** One type still to describe, and the schema object it fills in place. */
type SchemaTask = {
  type: ts.Type;
  /** The schema object to fill; it is already placed in its parent. */
  target: JsonSchema;
  /** The object types this one sits inside, to stop a type that contains itself. */
  ancestors: readonly ts.Type[];
  /** Whether the value can also be null. */
  nullable: boolean;
};

/** The state of one conversion. */
type Conversion = {
  checker: ts.TypeChecker;
  /** Where the body is built, for reading property types in context. */
  location: ts.Node;
  pending: SchemaTask[];
  /** Every `oneOf` schema made, in the order made, to sort once all are filled. */
  unions: JsonSchema[];
  /** How many tasks have run. */
  steps: number;
};

/**
 * The schema of the JSON a `NextResponse.json(body)` call answers with, or
 * null when its type says nothing useful (`any`, or too big to describe).
 * @param body - The first argument of the call.
 * @param checker - The type checker of a program holding the route.
 */
export function schemaForJsonBody(body: ts.Expression, checker: ts.TypeChecker): JsonSchema | null {
  const type = checker.getTypeAtLocation(body);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return null;
  }
  return schemaForType(type, checker, body);
}

/**
 * The schema of the JSON a value of a type is written as, or null when the
 * type is too big to describe.
 * @param type - The type to describe.
 * @param checker - The type checker that made it.
 * @param location - Where the value is built, for reading property types in context.
 */
export function schemaForType(type: ts.Type, checker: ts.TypeChecker, location: ts.Node): JsonSchema | null {
  const root: JsonSchema = {};
  const conversion: Conversion = { checker, location, pending: [{ type, target: root, ancestors: [], nullable: false }], unions: [], steps: 0 };
  while (conversion.pending.length > 0) {
    conversion.steps++;
    if (conversion.steps > MAX_TASKS) {
      return null;
    }
    describeInto(conversion.pending.pop()!, conversion);
  }
  // Later unions sit inside earlier ones, so sorting the last made first
  // means every union's members are final before it is sorted.
  for (let index = conversion.unions.length - 1; index >= 0; index--) {
    settleUnion(conversion.unions[index]!);
  }
  return root;
}

/**
 * One schema for every body a status can answer with: the shape itself when
 * they agree, `oneOf` when they differ.
 * @param schemas - The schemas of each body sent at one status.
 */
export function combineSchemas(schemas: JsonSchema[]): JsonSchema {
  const combined: JsonSchema = { oneOf: [...schemas] };
  settleUnion(combined);
  return combined;
}

/**
 * Fill one task's schema, queueing the types it contains.
 * @param task - The type to describe and where.
 * @param conversion - The conversion it belongs to.
 */
function describeInto(task: SchemaTask, conversion: Conversion): void {
  const { type, target } = task;
  const flags = type.flags;
  if (task.ancestors.length >= MAX_DEPTH || flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    fill(target, {}, task.nullable);
    return;
  }
  // `boolean` lands here too: it is the union `true | false` underneath, and
  // `describeUnion` writes both literals as a plain boolean.
  if (type.isUnion()) {
    describeUnion(task, type, conversion);
    return;
  }
  const primitive = primitiveSchema(type, conversion.checker);
  if (primitive) {
    fill(target, primitive, task.nullable);
    return;
  }
  if (flags & ts.TypeFlags.Null) {
    fill(target, {}, true);
    return;
  }
  if (flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection | ts.TypeFlags.NonPrimitive)) {
    describeObject(task, conversion);
    return;
  }
  // `undefined`, `void`, `never`, `bigint`, a symbol: nothing JSON can carry.
  fill(target, {}, task.nullable);
}

/**
 * The schema of a string, number or boolean type or literal, or null for
 * any other type.
 * @param type - The type.
 * @param checker - Its type checker, to read a boolean literal's value.
 */
function primitiveSchema(type: ts.Type, checker: ts.TypeChecker): JsonSchema | null {
  if (type.isStringLiteral()) {
    return { type: 'string', enum: [type.value] };
  }
  if (type.isNumberLiteral()) {
    return { type: 'number', enum: [type.value] };
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { type: 'boolean', enum: [checker.typeToString(type) === 'true'] };
  }
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping)) {
    return { type: 'string' };
  }
  if (type.flags & ts.TypeFlags.Number) {
    return { type: 'number' };
  }
  return null;
}

/**
 * Describe a union: `null` makes it nullable, `undefined` is dropped (the
 * property holding it is then optional), literals of one kind merge into one
 * `enum`, and what is left becomes `oneOf`.
 * @param task - The union's task.
 * @param union - The union type.
 * @param conversion - The conversion it belongs to.
 */
function describeUnion(task: SchemaTask, union: ts.UnionType, conversion: Conversion): void {
  const nullable = task.nullable || union.types.some(member => (member.flags & ts.TypeFlags.Null) !== 0);
  const strings: string[] = [];
  const numbers: number[] = [];
  const booleans = new Set<boolean>();
  const others: ts.Type[] = [];
  for (const member of union.types) {
    if (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
      continue;
    }
    if (member.isStringLiteral()) {
      strings.push(member.value);
    } else if (member.isNumberLiteral()) {
      numbers.push(member.value);
    } else if (member.flags & ts.TypeFlags.BooleanLiteral) {
      booleans.add(conversion.checker.typeToString(member) === 'true');
    } else {
      others.push(member);
    }
  }
  const variants: JsonSchema[] = [];
  if (strings.length > 0) {
    variants.push({ type: 'string', enum: [...new Set(strings)].sort() });
  }
  if (numbers.length > 0) {
    variants.push({ type: 'number', enum: [...new Set(numbers)].sort((left, right) => left - right) });
  }
  if (booleans.size > 0) {
    variants.push(booleans.size === 2 ? { type: 'boolean' } : { type: 'boolean', enum: [...booleans] });
  }
  if (variants.length + others.length === 0) {
    fill(task.target, {}, nullable);
    return;
  }
  if (variants.length + others.length === 1) {
    if (variants.length === 1) {
      fill(task.target, variants[0]!, nullable);
      return;
    }
    // One type left once `null` and `undefined` are gone: describe it in
    // place, at the same depth, since it is the same value.
    conversion.pending.push({ type: others[0]!, target: task.target, ancestors: task.ancestors, nullable });
    return;
  }
  for (const member of others) {
    const child: JsonSchema = {};
    variants.push(child);
    conversion.pending.push({ type: member, target: child, ancestors: task.ancestors, nullable: false });
  }
  fill(task.target, { oneOf: variants }, nullable);
  conversion.unions.push(task.target);
}

/**
 * Describe an object type: a date, something with `toJSON`, an array or
 * tuple, a map-like written as `{}`, or a plain object with its properties
 * and any string index signature.
 * @param task - The object's task.
 * @param conversion - The conversion it belongs to.
 */
function describeObject(task: SchemaTask, conversion: Conversion): void {
  const { type, target } = task;
  const { checker, location } = conversion;
  if (task.ancestors.includes(type)) {
    fill(target, { type: 'object' }, task.nullable);
    return;
  }
  if (isJsonFileData(type)) {
    // Data read from a `.json` file is content, not a contract: its type is
    // whatever the file holds today. `GET /api/v1/openapi` answers with this
    // very document, so describing it would describe the last version of the
    // document and change it on every run.
    fill(target, { type: 'object' }, task.nullable);
    return;
  }
  const ancestors = [...task.ancestors, type];
  const symbolName = type.getSymbol()?.getName();
  if (symbolName === 'Date') {
    fill(target, { type: 'string', format: 'date-time' }, task.nullable);
    return;
  }
  const writtenAs = toJsonReturnType(type, checker, location);
  if (writtenAs) {
    conversion.pending.push({ type: writtenAs, target, ancestors, nullable: task.nullable });
    return;
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    describeArray(task, ancestors, conversion);
    return;
  }
  if (symbolName && WRITTEN_AS_EMPTY_OBJECT.has(symbolName)) {
    fill(target, { type: 'object' }, task.nullable);
    return;
  }
  const schema: JsonSchema = { type: 'object' };
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const name = property.getName();
    const propertyType = checker.getTypeOfSymbolAtLocation(property, location);
    // Symbol keys and functions never reach the JSON.
    if (name.startsWith('__@') || property.flags & ts.SymbolFlags.Method || propertyType.getCallSignatures().length > 0) {
      continue;
    }
    const child: JsonSchema = {};
    properties[name] = child;
    if (!isOptional(property, propertyType)) {
      required.push(name);
    }
    conversion.pending.push({ type: propertyType, target: child, ancestors, nullable: false });
  }
  if (Object.keys(properties).length > 0) {
    schema.properties = properties;
  }
  if (required.length > 0) {
    schema.required = required;
  }
  const stringIndex = checker.getIndexInfosOfType(type).find(info => (info.keyType.flags & ts.TypeFlags.String) !== 0);
  if (stringIndex) {
    const values: JsonSchema = {};
    schema.additionalProperties = values;
    conversion.pending.push({ type: stringIndex.type, target: values, ancestors, nullable: false });
  }
  if (!schema.properties && !stringIndex && type.getCallSignatures().length > 0) {
    // A bare function: `JSON.stringify` writes nothing for it.
    fill(target, {}, task.nullable);
    return;
  }
  fill(target, schema, task.nullable);
}

/**
 * Describe an array, or a tuple as an array of any of its element types.
 * @param task - The array's task.
 * @param ancestors - The object types it sits inside, itself included.
 * @param conversion - The conversion it belongs to.
 */
function describeArray(task: SchemaTask, ancestors: readonly ts.Type[], conversion: Conversion): void {
  const elements = conversion.checker.getTypeArguments(task.type as ts.TypeReference);
  if (elements.length === 0) {
    fill(task.target, { type: 'array', items: {} }, task.nullable);
    return;
  }
  const items: JsonSchema = {};
  fill(task.target, { type: 'array', items }, task.nullable);
  if (elements.length === 1) {
    conversion.pending.push({ type: elements[0]!, target: items, ancestors, nullable: false });
    return;
  }
  const variants: JsonSchema[] = [];
  for (const element of elements) {
    const child: JsonSchema = {};
    variants.push(child);
    conversion.pending.push({ type: element, target: child, ancestors, nullable: false });
  }
  items.oneOf = variants;
  conversion.unions.push(items);
}

/**
 * What a type's `toJSON` method returns, which is what `JSON.stringify`
 * writes in its place, or null when it has none.
 * @param type - The object type.
 * @param checker - Its type checker.
 * @param location - Where the value is built.
 */
function toJsonReturnType(type: ts.Type, checker: ts.TypeChecker, location: ts.Node): ts.Type | null {
  const toJson = checker.getPropertyOfType(type, 'toJSON');
  if (!toJson) {
    return null;
  }
  const [signature] = checker.getTypeOfSymbolAtLocation(toJson, location).getCallSignatures();
  return signature ? signature.getReturnType() : null;
}

/**
 * Whether a type is the shape of a `.json` file imported as a module.
 * @param type - An object type.
 */
function isJsonFileData(type: ts.Type): boolean {
  const declarations = type.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(declaration => declaration.getSourceFile().fileName.endsWith('.json'));
}

/**
 * Whether a property may be left out of the JSON: declared optional, or able
 * to be `undefined`, which `JSON.stringify` leaves out.
 * @param property - The property.
 * @param propertyType - Its type where the body is built.
 */
function isOptional(property: ts.Symbol, propertyType: ts.Type): boolean {
  if (property.flags & ts.SymbolFlags.Optional) {
    return true;
  }
  const members = propertyType.isUnion() ? propertyType.types : [propertyType];
  return members.some(member => (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0);
}

/**
 * Write a schema into its place, marking it nullable when the value can be null.
 * @param target - The schema object to fill.
 * @param schema - What to write.
 * @param nullable - Whether the value can also be null.
 */
function fill(target: JsonSchema, schema: JsonSchema, nullable: boolean): void {
  Object.assign(target, schema);
  if (nullable) {
    target.nullable = true;
  }
}

/**
 * Put a finished `oneOf` in its final form: duplicates removed, members
 * sorted, and a single member written in place of the `oneOf`.
 * @param union - A schema holding `oneOf`.
 */
function settleUnion(union: JsonSchema): void {
  const byText = new Map<string, JsonSchema>();
  for (const member of union.oneOf as JsonSchema[]) {
    byText.set(JSON.stringify(member), member);
  }
  const members = [...byText.keys()].sort().map(text => byText.get(text)!);
  delete union.oneOf;
  if (members.length === 1) {
    // Keep a `nullable` the union carried; the member's own fields go first.
    const nullable = union.nullable;
    delete union.nullable;
    Object.assign(union, members[0]);
    if (nullable) {
      union.nullable = true;
    }
    return;
  }
  union.oneOf = members;
}
