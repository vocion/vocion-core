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
 *   - Except `harness`, which is merged KEY BY KEY: it is a bag of
 *     independent settings (model, runsOn, excludeTools…), and an override
 *     that pins a model must not silently drop the base's tool exclusions.
 *     On 2026-09-29 the squatch-factory designer override
 *     (`harness: {modelProvider, model}`) replaced the plugin's harness and
 *     put render_document back on a designer built not to have it. Inside it,
 *     arrays take the same directives; a whole-list value still replaces,
 *     except `grantTools` (below).
 *   - `harness.grantTools` ADDS to the base's grants: a plain list is the
 *     base list plus these. An override that pins a model or adds one tool
 *     must not silently take away a tool the plugin grants. On 2026-10-01
 *     the squatch-factory change-reviewer override (`grantTools:
 *     [record_verdict, product_access]`) dropped the plugin's `check_live`,
 *     and release REL-301 went unchecked. To drop grants, say so:
 *     `grantToolsMode: replace` makes the list the whole list, and
 *     `{ $remove: [x] }` takes one away.
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

/** Objects merged key by key rather than replaced (see the module doc). */
const KEY_MERGED: ReadonlySet<string> = new Set(['harness']);

/** Lists inside a key-merged object that add to the base rather than replace it. */
const ADDITIVE_LISTS: Readonly<Record<string, { mode: string }>> = {
  grantTools: { mode: 'grantToolsMode' },
};

/** The explicit opt-out: the override's list is the whole list. */
export const LIST_MODE_REPLACE = 'replace';

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
  return mergeObject(base, patch, false);
}

/**
 * @param base - the base object
 * @param patch - the override object
 * @param keyMerged - true inside a key-merged block (`harness`), where additive lists apply
 */
function mergeObject(base: Raw, patch: Raw, keyMerged: boolean): Raw {
  const out: Raw = { ...base };
  const modeKeys = keyMerged ? new Set(Object.values(ADDITIVE_LISTS).map(l => l.mode)) : new Set<string>();
  for (const [key, patchValue] of Object.entries(patch)) {
    if (modeKeys.has(key)) {
      // A merge instruction, not a setting: it never reaches the stored row.
      continue;
    }
    const additive = keyMerged ? ADDITIVE_LISTS[key] : undefined;
    if (isArrayDirective(patchValue)) {
      out[key] = applyDirective(base[key], patchValue, key);
    } else if (additive && Array.isArray(patchValue) && patch[additive.mode] !== LIST_MODE_REPLACE) {
      out[key] = applyDirective(base[key], { $append: patchValue }, key);
    } else if (KEY_MERGED.has(key) && isPlainObject(patchValue) && isPlainObject(base[key])) {
      out[key] = mergeObject(base[key] as Raw, patchValue, true);
    } else if (KEY_MERGED.has(key) && isPlainObject(patchValue)) {
      // No base block to merge onto: the override's block, without its merge instructions.
      out[key] = mergeObject({}, patchValue, true);
    } else {
      out[key] = patchValue;
    }
  }
  for (const mode of modeKeys) {
    delete out[mode];
  }
  return out;
}

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeError';
  }
}
