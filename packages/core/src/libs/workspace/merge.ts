/**
 * Deep-merge engine for the base-pack layering (ticket 007).
 *
 * A workspace resource marked `extends: core` is a PATCH over a same-slug
 * base default. This module resolves that patch against the base at the
 * raw-YAML-object level — BEFORE Zod validation — so a directive like
 * `{ $append: [x] }` never has to satisfy the array schema. The merged
 * object is validated by the normal strict schema afterwards.
 *
 * Merge vocabulary (see docs/workspace.md):
 *   - Scalars & objects (model, systemPromptFile, searchConfig) → the
 *     workspace value REPLACES the base value wholesale.
 *   - Arrays (skills, connectorSources, objectTypes) → default REPLACE;
 *     opt into extend semantics with directives:
 *       { $append: [x] }  → base list + x   (order-preserving, de-duped)
 *       { $remove: [y] }  → base list − y
 *       [a, b]            → full replace (unchanged from today)
 *
 * Pure: no I/O, no schema, no DB. This is where the semantics are pinned.
 */

/** Where a resolved resource came from, for provenance + drilldown. */
export type Origin = 'core' | 'workspace' | 'merged';

/** The `extends` marker on a workspace resource file. `core` = "patch the same-slug base default". */
export const EXTENDS_CORE = 'core';

type Raw = Record<string, unknown>;

type ArrayDirective = { $append?: unknown[]; $remove?: unknown[] };

function isPlainObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A value is an array directive when it's a plain object whose keys are a
 * non-empty subset of {$append, $remove}. Anything else — including a
 * regular object with other keys — is treated as a plain replacement.
 * @param v - the raw YAML value to classify
 */
export function isArrayDirective(v: unknown): v is ArrayDirective {
  if (!isPlainObject(v)) {
    return false;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) {
    return false;
  }
  return keys.every(k => k === '$append' || k === '$remove');
}

/**
 * Order-preserving de-dupe for slug lists.
 * @param items - the list to de-duplicate, first occurrence wins
 */
function dedupe(items: unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function applyDirective(baseValue: unknown, directive: ArrayDirective, key: string): unknown[] {
  const base = baseValue === undefined ? [] : baseValue;
  if (!Array.isArray(base)) {
    throw new MergeError(`cannot apply an array directive to "${key}": the base value is not a list`);
  }
  let result = [...base];
  if (directive.$remove !== undefined) {
    if (!Array.isArray(directive.$remove)) {
      throw new MergeError(`"${key}.$remove" must be a list`);
    }
    const remove = new Set(directive.$remove);
    result = result.filter(x => !remove.has(x));
  }
  if (directive.$append !== undefined) {
    if (!Array.isArray(directive.$append)) {
      throw new MergeError(`"${key}.$append" must be a list`);
    }
    result = dedupe([...result, ...directive.$append]);
  }
  return result;
}

/**
 * Merge a workspace PATCH onto a BASE manifest object. Returns a new
 * object; neither input is mutated. Keys present only in `base` are
 * inherited unchanged; keys in `patch` either apply an array directive or
 * replace the base value outright.
 * @param base - the validated base default, as a raw YAML object
 * @param patch - the workspace override, as a raw YAML object (with `extends` already stripped)
 */
export function mergeManifest(base: Raw, patch: Raw): Raw {
  const out: Raw = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (isArrayDirective(patchValue)) {
      out[key] = applyDirective(base[key], patchValue, key);
    } else {
      out[key] = patchValue;
    }
  }
  return out;
}

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeError';
  }
}
