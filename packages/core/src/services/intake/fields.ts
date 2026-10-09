/**
 * WHAT A RECORD OF THIS TYPE HOLDS, read off the type itself.
 *
 * List intake turns dropped files into records of a type the agent chose. It
 * names no type and no field: the fields it asks the model for are the type's
 * declared properties, and the fields it matches on to find a duplicate are
 * the ones the type marks as its identity (`x-identity`), or the ones the
 * agent names in the call. A type with neither is matched on any field whose
 * schema says it holds an email address, and on nothing else — a duplicate
 * guessed from a field name would be a concretion (CLAUDE.md, rule 5).
 *
 * Pure: the schema in, plain data out.
 */

/** One field a record of the type may carry, as the extractor is told about it. */
export type IntakeField = {
  name: string;
  /** JSON Schema `type` (`string`, `number`, `integer`, `boolean`, `array`). */
  type: string;
  description?: string;
  /** Allowed values, when the type says. */
  enum?: string[];
  /** `email`, `uri`, `date`… from the schema. */
  format?: string;
};

/**
 * The fields that say two records are the same thing, strongest first: an
 * email matches on its own; a name matches only together with its company.
 */
export type IntakeIdentity = {
  email?: string;
  name?: string;
  company?: string;
};

/** The schema key a type declares its identity under. */
export const IDENTITY_KEY = 'x-identity';

/**
 * The fields a type declares, in the order it declares them. Objects and
 * arrays of objects are left out: a badge or a card does not print one, and a
 * model asked for one invents its shape.
 * @param schema - The type's JSON Schema (`business_object_type.schema`).
 */
export function intakeFields(schema: Record<string, unknown> | null | undefined): IntakeField[] {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const out: IntakeField[] = [];
  for (const [name, spec] of Object.entries(props)) {
    if (!spec || typeof spec !== 'object') {
      continue;
    }
    const type = typeof spec.type === 'string' ? spec.type : 'string';
    if (type === 'object') {
      continue;
    }
    if (type === 'array') {
      const items = (spec.items ?? {}) as Record<string, unknown>;
      if (items.type !== 'string') {
        continue;
      }
    }
    out.push({
      name,
      type,
      ...(typeof spec.description === 'string' ? { description: spec.description } : {}),
      ...(Array.isArray(spec.enum) ? { enum: spec.enum.map(String) } : {}),
      ...(typeof spec.format === 'string' ? { format: spec.format } : {}),
    });
  }
  return out;
}

/**
 * Which fields identify a record: what the call names, else what the type
 * declares under `x-identity`, else any field formatted as an email. A name
 * the type does not declare falls through to the next, so a field the agent
 * mistyped never matches everything on an empty value.
 * @param schema - The type's JSON Schema.
 * @param given - What the agent named in the call, if anything.
 */
export function intakeIdentity(schema: Record<string, unknown> | null | undefined, given?: IntakeIdentity): IntakeIdentity {
  const fields = intakeFields(schema);
  const known = new Set(fields.map(f => f.name));
  const declared = (schema?.[IDENTITY_KEY] ?? {}) as IntakeIdentity;
  const pick = (key: keyof IntakeIdentity): string | undefined => {
    const asked = given?.[key];
    if (asked && known.has(asked)) {
      return asked;
    }
    return declared[key] && known.has(declared[key]) ? declared[key] : undefined;
  };
  const email = pick('email') ?? fields.find(f => f.format === 'email')?.name;
  const name = pick('name');
  const company = pick('company');
  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(company ? { company } : {}),
  };
}

/**
 * A record's title: its name field, else the first short text field it has,
 * else nothing — and a record with no title is one the person is asked about.
 * @param values - The record's fields.
 * @param identity - Which field is the name.
 * @param fields - The type's fields, in order.
 */
export function intakeTitle(values: Record<string, unknown>, identity: IntakeIdentity, fields: readonly IntakeField[]): string | null {
  const named = identity.name ? values[identity.name] : undefined;
  if (typeof named === 'string' && named.trim()) {
    return named.trim().slice(0, 200);
  }
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'string' && typeof v === 'string' && v.trim() && v.length <= 120 && f.name !== identity.email) {
      return v.trim();
    }
  }
  const email = identity.email ? values[identity.email] : undefined;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

/**
 * A value as the type wants it, or undefined when it cannot be: a number for
 * a number field, one of the enum for an enum, a list of strings for a list.
 * The model reads print, so `"42"` for an integer is fine and `"about forty"`
 * is not.
 * @param field - The field.
 * @param value - What the model read.
 */
export function coerceValue(field: IntakeField, value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (field.type === 'number' || field.type === 'integer') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
    if (!Number.isFinite(n)) {
      return undefined;
    }
    return field.type === 'integer' ? Math.round(n) : n;
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === 'yes' ? true : s === 'false' || s === 'no' ? false : undefined;
  }
  if (field.type === 'array') {
    const list = Array.isArray(value) ? value.map(String) : String(value).split(/[,;]\s*/);
    const clean = list.map(s => s.trim()).filter(Boolean);
    return clean.length > 0 ? clean : undefined;
  }
  const text = String(value).trim();
  if (field.enum) {
    return field.enum.find(e => e.toLowerCase() === text.toLowerCase());
  }
  return text || undefined;
}
