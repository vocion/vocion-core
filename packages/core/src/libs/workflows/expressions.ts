/**
 * WHAT A WORKFLOW STRING MEANS AT RUN TIME (`docs/entities/workflow.md`).
 *
 * Two small languages, both pure:
 *
 * - **Interpolation.** `{{input.x}}`, `{{steps.<name>.output.y}}`,
 *   `{{trigger.y}}` and, inside a repeat group, `{{repeat.round}}` /
 *   `{{repeat.max}}`. A string that is one reference and nothing else keeps
 *   the referenced value's type (an object stays an object); a reference
 *   inside text is written as text, a missing one as nothing.
 * - **Conditions** — a step's `when` and a repeat group's `until`. One
 *   comparison or one value, never a language: `{{a}} == 'pass'`,
 *   `{{a}} != 'none'`, or `{{a}}` alone (true when it holds something).
 *   Operands are a reference, a quoted string, a number, `true`, `false` or
 *   `null`. Anything else is refused when the workflow is checked, so a typo
 *   fails at `workspace:check` instead of skipping a step at run time.
 *
 * No database, no clock: the engine (`services/WorkflowService.ts`) hands in
 * the scope.
 */

/** What a run's strings can read. */
export type WorkflowScope = {
  input: Record<string, unknown>;
  steps: Record<string, { output: unknown }>;
  trigger: Record<string, unknown>;
  /** Set inside a repeat group: the round being run (from 1) and the group's `max`. */
  repeat?: { round: number; max: number };
};

/** A reference: `{{steps.review-draft.output.verdict}}`. Step names are slugs, so a dash is part of a path. */
const REF = /\{\{\s*([\w.-]+)\s*\}\}/g;
const WHOLE_REF = /^\{\{\s*([\w.-]+)\s*\}\}$/;

/**
 * The value at a dotted path, or undefined.
 * @param scope - What the run can read.
 * @param path - `steps.review.output.verdict`.
 */
export function resolvePath(scope: unknown, path: string): unknown {
  let current: unknown = scope;
  for (const seg of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * A value as text inside a sentence: strings as they are, nothing for a
 * missing value, JSON for anything else.
 * @param v - The value.
 */
function asText(v: unknown): string {
  return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Interpolate one string.
 * @param template - The authored string.
 * @param scope - What the run can read.
 */
export function interpolateString(template: string, scope: unknown): unknown {
  // A whole-string reference keeps its type, so `{{steps.summary.output}}`
  // hands the next step an object rather than its JSON.
  const whole = WHOLE_REF.exec(template);
  if (whole) {
    return resolvePath(scope, whole[1]!);
  }
  return template.replaceAll(REF, (_, path: string) => asText(resolvePath(scope, path)));
}

/**
 * Interpolate one string and always get text back: a label, a task.
 * @param template - The authored string.
 * @param scope - What the run can read.
 */
export function interpolateText(template: string, scope: unknown): string {
  return asText(interpolateString(template, scope));
}

/**
 * Interpolate every string leaf of a value. Other leaves pass through.
 * @param value - An authored value (a step's `input`).
 * @param scope - What the run can read.
 */
export function interpolateValue(value: unknown, scope: unknown): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolateValue(v, scope));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateValue(v, scope);
    }
    return out;
  }
  return value;
}

/** One side of a condition. */
type Operand = { kind: 'ref'; path: string } | { kind: 'literal'; value: string | number | boolean | null };

/** A parsed `when` or `until`. */
export type Condition = { left: Operand; op?: '==' | '!='; right?: Operand };

const OPERAND = String.raw`\{\{\s*[\w.-]+\s*\}\}|'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|true|false|null`;
const CONDITION = new RegExp(String.raw`^(${OPERAND})(?:\s*(==|!=)\s*(${OPERAND}))?$`);

/**
 * Read one operand's source text.
 * @param src - `{{a.b}}`, `'pass'`, `3`, `true`.
 */
function operand(src: string): Operand {
  const ref = WHOLE_REF.exec(src);
  if (ref) {
    return { kind: 'ref', path: ref[1]! };
  }
  if (src.startsWith('\'') || src.startsWith('"')) {
    return { kind: 'literal', value: src.slice(1, -1) };
  }
  if (src === 'true' || src === 'false') {
    return { kind: 'literal', value: src === 'true' };
  }
  if (src === 'null') {
    return { kind: 'literal', value: null };
  }
  return { kind: 'literal', value: Number(src) };
}

/**
 * Parse a condition, or say why it is not one.
 * @param source - The authored `when` / `until`.
 */
export function parseCondition(source: string): { ok: true; condition: Condition } | { ok: false; error: string } {
  const m = CONDITION.exec(source.trim());
  if (!m) {
    return {
      ok: false,
      error: `"${source}" is not a condition. Write one comparison, like {{steps.review.output.verdict}} == 'pass' or {{input.target}} != 'none', or one reference on its own, like {{steps.check.output.ready}}`,
    };
  }
  const left = operand(m[1]!);
  if (!m[2]) {
    return { ok: true, condition: { left } };
  }
  const right = operand(m[3]!);
  if (left.kind === 'literal' && right.kind === 'literal') {
    return { ok: false, error: `"${source}" compares two fixed values, so it never changes; compare a reference like {{input.x}}` };
  }
  return { ok: true, condition: { left, op: m[2] as '==' | '!=', right } };
}

/**
 * Every `{{...}}` path a string reads.
 * @param source - Any authored string.
 */
export function referencedPaths(source: string): string[] {
  return [...source.matchAll(REF)].map(m => m[1]!);
}

/**
 * A value as a comparison reads it: missing is empty, objects are JSON.
 * @param v - The value.
 */
function comparable(v: unknown): string {
  return asText(v);
}

/**
 * Whether a value holds something: not missing, empty, false, zero, an empty
 * list or object, or the words "false" / "no".
 * @param v - The value.
 */
export function holds(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === 0 || v === '') {
    return false;
  }
  if (typeof v === 'string') {
    return !['false', 'no', '0'].includes(v.trim().toLowerCase()) && v.trim() !== '';
  }
  if (Array.isArray(v)) {
    return v.length > 0;
  }
  if (typeof v === 'object') {
    return Object.keys(v as object).length > 0;
  }
  return true;
}

/**
 * Evaluate a condition against a run's scope. A source that does not parse
 * throws: the schema refuses it first, so reaching here means a row written
 * around the check, and a step must not silently run or skip on a typo.
 * @param source - The authored `when` / `until`.
 * @param scope - What the run can read.
 */
export function evaluateCondition(source: string, scope: unknown): boolean {
  const parsed = parseCondition(source);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const { left, op, right } = parsed.condition;
  const value = (o: Operand) => (o.kind === 'ref' ? resolvePath(scope, o.path) : o.value);
  if (!op || !right) {
    return holds(value(left));
  }
  const same = comparable(value(left)) === comparable(value(right));
  return op === '==' ? same : !same;
}
