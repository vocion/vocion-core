/**
 * `response.select` — a declarative projection on what a REST endpoint
 * answers, so a tool returns only the fields its contract names regardless
 * of what the API serves. A custom Strapi route ignores `fields[]`, and a
 * list whose every row carries a page of JSON blows the `maxChars` cap on
 * three rows; the contract says which leaves matter, and the rest never
 * reaches the model.
 *
 * A path is dotted (`name`, `company.name`); `[]` after a key means every
 * element of that array (`data[].documentId`, `data[].company.name`); a
 * segment that is only `[]` means every element of the value itself, for an
 * endpoint whose `pick` already lands on an array (`[].name`). The output
 * keeps the original nesting of the selected leaves — `data[].documentId`
 * and `data[].name` yield `{ data: [{ documentId, name }, …] }` — and any
 * key not selected, `meta` included, is gone. A path that resolves to
 * nothing is simply absent: no error, no null. A `*` leaf is not supported;
 * the contract names its fields.
 *
 * Applied after `pick` and before `maxChars`, in the read tool
 * (`services/agents/tools/restDirect.ts`) and in the `rest.request` action's
 * result (`libs/actions/rest.ts`). Validated at apply by
 * {@link selectPathProblem}, so a path the tool applies is one that parsed.
 */

/** The characters a path may use, as the guide documents them. */
const PATH_CHARS = /^[\w.[\]-]+$/;
/** One segment: a key, optionally followed by `[]` one or more times — or `[]` alone. */
const SEGMENT = /^([\w-]*)((?:\[\])*)$/;

type Step = { kind: 'key'; name: string } | { kind: 'each' };

/**
 * Why a path is not a valid selection, or null when it is.
 * @param path - One entry of `response.select`.
 */
export function selectPathProblem(path: unknown): string | null {
  if (typeof path !== 'string') {
    return `must be a string path such as data[].name; got ${JSON.stringify(path)}`;
  }
  if (path === '') {
    return 'must not be empty';
  }
  if (!PATH_CHARS.test(path)) {
    return `"${path}" may only use letters, digits, _, -, . and []`;
  }
  for (const segment of path.split('.')) {
    const m = SEGMENT.exec(segment);
    if (!m) {
      return `"${path}": "${segment}" is not a key optionally followed by []`;
    }
    if (m[1] === '' && m[2] === '') {
      return `"${path}" has an empty segment`;
    }
  }
  return null;
}

/**
 * A path as steps. Assumes {@link selectPathProblem} answered null.
 * @param path - One selection path.
 */
function stepsOf(path: string): Step[] {
  const steps: Step[] = [];
  for (const segment of path.split('.')) {
    const m = SEGMENT.exec(segment)!;
    if (m[1]) {
      steps.push({ kind: 'key', name: m[1] });
    }
    for (let i = 0; i < m[2]!.length / 2; i++) {
      steps.push({ kind: 'each' });
    }
  }
  return steps;
}

/** The selection as a tree: what to keep at each level. */
type Node = {
  /** Keep the whole value here (a path ended). A leaf beats any deeper path. */
  leaf: boolean;
  /** Keep these keys of an object. */
  keys: Map<string, Node>;
  /** Keep this of every element of an array. */
  each?: Node;
};

function node(): Node {
  return { leaf: false, keys: new Map() };
}

function treeOf(paths: readonly string[]): Node {
  const root = node();
  for (const path of paths) {
    let cursor = root;
    for (const step of stepsOf(path)) {
      if (step.kind === 'each') {
        cursor.each ??= node();
        cursor = cursor.each;
      } else {
        let next = cursor.keys.get(step.name);
        if (!next) {
          next = node();
          cursor.keys.set(step.name, next);
        }
        cursor = next;
      }
    }
    cursor.leaf = true;
  }
  return root;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a level selected, or nothing. */
type Picked = { present: true; value: unknown } | { present: false };

const NOTHING: Picked = { present: false };

/**
 * Apply one level of the tree to a value.
 * @param value - The value at this level.
 * @param at - The tree at this level.
 */
function apply(value: unknown, at: Node): Picked {
  if (at.leaf) {
    return value === undefined ? NOTHING : { present: true, value };
  }
  if (Array.isArray(value)) {
    if (!at.each) {
      return NOTHING;
    }
    const out: unknown[] = [];
    for (const element of value) {
      const picked = apply(element, at.each);
      if (picked.present) {
        out.push(picked.value);
      } else if (isPlainObject(element)) {
        // The row exists even when none of its selected fields do.
        out.push({});
      }
    }
    return { present: true, value: out };
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    let any = false;
    for (const [key, child] of at.keys) {
      const picked = apply(value[key], child);
      if (picked.present) {
        out[key] = picked.value;
        any = true;
      }
    }
    return any ? { present: true, value: out } : NOTHING;
  }
  return NOTHING;
}

/**
 * The selected leaves of a response, in their original nesting. `{}` when
 * nothing selected resolves (an empty projection, never an error), and the
 * value itself when there is nothing to select by.
 * @param data - The response, after `pick`.
 * @param paths - The `response.select` entries, already validated.
 */
export function selectPaths(data: unknown, paths: readonly string[] | undefined): unknown {
  if (!paths || paths.length === 0) {
    return data;
  }
  const picked = apply(data, treeOf(paths));
  return picked.present ? picked.value : {};
}
