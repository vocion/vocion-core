/**
 * `verify` — checks a `rest` source's write runs against the source's own
 * read endpoints BEFORE a proposal becomes a card.
 *
 * The input schema can say an argument is a list of at most ten strings that
 * look like ticket keys. It cannot say each key is the right KIND of ticket,
 * or that the "currently" a card shows is what the record holds. Only the
 * API can, so an action may declare reads to make first:
 *
 *   verify:
 *     - each: epicKeys              # one read per entry; {item} names it
 *       tool: get_issue             # a declared tools[] entry on this source
 *       input: { projectId: "{projectId}", issueKey: "{item}" }
 *       expect: { path: fields.issuetype.name, in: [Epic] }
 *       also: { parent: fields.parent.key }
 *       refuse: "{item} is a {found}, not an Epic (its parent: {parent})."
 *     - when: epicKeys              # once, only when this argument was sent
 *       tool: get_record
 *       input: { id: "{id}" }
 *       expect: { path: 0.epicKeys, sameItemsAs: previousEpicKeys }
 *       refuse: "The record links {found}; pass that as previousEpicKeys."
 *
 * `expect.in` holds when the value at `path` is one of the listed strings
 * (case-insensitive); `expect.sameItemsAs` holds when the list at `path` and
 * the named argument hold the same entries in any order, absent counting as
 * empty. A read that fails refuses too, with the API's own words: a check
 * that could not be made is not a check that passed.
 *
 * Every refusal from one proposal is reported together, so the proposer
 * fixes every bad entry in one pass. Nothing here names a product: the
 * reads, the paths and the wording all come from the workspace.
 */

import type { TemplateArgs, TemplateClock } from './template';
import { z } from 'zod';
import { placeholdersIn, renderString } from './template';

/** The most reads one `each` check may make, whatever the argument's own cap says. */
export const VERIFY_MAX_EACH = 25;

/** A dotted path into a read's answer; digits index arrays (`0.jiraEpics`). */
const ValuePathSchema = z.string().regex(/^[\w$]+(?:\.[\w$]+)*$/, 'must be a dotted path, e.g. fields.status.name or 0.keys');

export const RestVerifySchema = z.object({
  /** An array argument: the read is made once per entry, which `{item}` names. */
  each: z.string().optional(),
  /** An argument: the check runs only when it was supplied. */
  when: z.string().optional(),
  /** A `tools[]` entry on the same source. */
  tool: z.string().min(1),
  /** The read's arguments, as templates over this action's input (and `{item}`). */
  input: z.record(z.string().min(1), z.string()).default({}),
  expect: z.union([
    z.object({ path: ValuePathSchema, in: z.array(z.string().min(1)).min(1) }).strict(),
    z.object({ path: ValuePathSchema, sameItemsAs: z.string().min(1) }).strict(),
  ]),
  /** More values from the same answer for the refusal: name to path. */
  also: z.record(z.string().regex(/^[a-z_]\w*$/i), ValuePathSchema).default({}),
  /** The sentence the proposer gets. `{found}` is the value at `path`; `{item}`, the entry. */
  refuse: z.string().min(1),
}).strict();
export type RestVerify = z.infer<typeof RestVerifySchema>;

/** What the apply check needs to know about the action and its source. */
export type VerifyContext = {
  /** The action's declared input property names, and which are arrays with which cap. */
  properties: Record<string, { array: boolean; maxItems?: number }>;
  /** The source's read tools: name to required argument names. */
  tools: Record<string, { declared: string[]; required: string[] }>;
};

/**
 * Every way one action's `verify` list is wrong, as sentences. Run at apply.
 * @param checks - The parsed `verify` entries.
 * @param ctx - The action's input and the source's tools.
 */
export function verifyProblems(checks: RestVerify[], ctx: VerifyContext): string[] {
  const problems: string[] = [];
  checks.forEach((check, i) => {
    const at = `verify[${i}]`;
    const declared = new Set(Object.keys(ctx.properties));
    if (check.each !== undefined) {
      const prop = ctx.properties[check.each];
      if (!prop?.array) {
        problems.push(`${at}: each names "${check.each}", which is not an array argument of this action`);
      } else if (prop.maxItems === undefined || prop.maxItems > VERIFY_MAX_EACH) {
        problems.push(`${at}: "${check.each}" needs maxItems of at most ${VERIFY_MAX_EACH}, so one proposal cannot fan out into unbounded reads`);
      }
    }
    if (check.when !== undefined && !declared.has(check.when)) {
      problems.push(`${at}: when names "${check.when}", which is not an argument of this action`);
    }
    if ('sameItemsAs' in check.expect && !ctx.properties[check.expect.sameItemsAs]?.array) {
      problems.push(`${at}: expect.sameItemsAs names "${check.expect.sameItemsAs}", which is not an array argument of this action`);
    }
    const tool = ctx.tools[check.tool];
    if (!tool) {
      problems.push(`${at}: tool "${check.tool}" is not one of this source's tools`);
    } else {
      for (const name of Object.keys(check.input)) {
        if (!tool.declared.includes(name)) {
          problems.push(`${at}: "${name}" is not an argument of tool ${check.tool}`);
        }
      }
      for (const name of tool.required) {
        if (!(name in check.input)) {
          problems.push(`${at}: tool ${check.tool} requires "${name}", which input does not pass`);
        }
      }
    }
    const inScope = new Set([...declared, ...(check.each !== undefined ? ['item'] : [])]);
    for (const template of Object.values(check.input)) {
      for (const name of placeholdersIn(template)) {
        if (!inScope.has(name)) {
          problems.push(`${at}: input uses {${name}}, which is not an argument of this action${check.each === undefined ? ' ({item} needs each)' : ''}`);
        }
      }
    }
    const inRefusal = new Set([...inScope, 'found', ...Object.keys(check.also)]);
    for (const name of placeholdersIn(check.refuse)) {
      if (!inRefusal.has(name)) {
        problems.push(`${at}: refuse uses {${name}}, which is not an argument, {found}, {item} or a name under also`);
      }
    }
  });
  return problems;
}

/**
 * The value at a dotted path, digits indexing arrays. `undefined` when any step is missing.
 * @param data - The read's answer, after the tool's own `response.pick`.
 * @param path - E.g. `fields.issuetype.name` or `0.jiraEpics`.
 */
export function valueAt(data: unknown, path: string): unknown {
  let node: unknown = data;
  for (const step of path.split('.')) {
    if (Array.isArray(node) && /^\d+$/.test(step)) {
      node = node[Number(step)];
    } else if (typeof node === 'object' && node !== null) {
      node = (node as Record<string, unknown>)[step];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * A value as a refusal reads it: a list comma-joined (or "none"), anything absent as "none".
 * @param value - Any value from an answer or the input.
 */
export function asWords(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'none';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map(asWords).join(', ');
  }
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * A list's entries as a comparable set of strings; absent is empty.
 * @param value - A list, or nothing.
 */
function itemSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.map(entry => String(entry)) : []);
}

/** One read a check makes: the tool's name and its arguments. */
export type VerifyRead = (tool: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>;

/**
 * Whether one answer meets the expectation.
 * @param check - The check.
 * @param found - The value at its path.
 * @param args - The action's validated input.
 */
function holds(check: RestVerify, found: unknown, args: TemplateArgs): boolean {
  if ('in' in check.expect) {
    return typeof found === 'string' && check.expect.in.some(option => option.toLowerCase() === found.toLowerCase());
  }
  const a = itemSet(found);
  const b = itemSet(args[check.expect.sameItemsAs]);
  return a.size === b.size && [...a].every(entry => b.has(entry));
}

/**
 * The refusal for a proposal whose `verify` checks fail, or `undefined` when
 * every one holds. Reads run in parallel within a check; every failing entry
 * is reported, one sentence each.
 * @param checks - The action's `verify` list.
 * @param args - The action's validated, normalized input.
 * @param read - Makes one read against the source.
 * @param clock - What built-in dates in a read's input resolve against.
 */
export async function runVerify(checks: RestVerify[], args: TemplateArgs, read: VerifyRead, clock?: TemplateClock): Promise<string | undefined> {
  const refusals: string[] = [];
  for (const check of checks) {
    if (check.when !== undefined && (args[check.when] === undefined || args[check.when] === null)) {
      continue;
    }
    const items: Array<unknown> = check.each === undefined ? [undefined] : Array.isArray(args[check.each]) ? (args[check.each] as unknown[]).slice(0, VERIFY_MAX_EACH) : [];
    const outcomes = await Promise.all(items.map(async (item) => {
      const scope: TemplateArgs = check.each === undefined ? args : { ...args, item };
      const readArgs: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const [name, template] of Object.entries(check.input)) {
        const value = renderString(template, scope, clock);
        if (value === undefined) {
          missing.push(...placeholdersIn(template).filter(p => scope[p] === undefined || scope[p] === null));
        } else {
          readArgs[name] = value;
        }
      }
      const subject = check.each === undefined ? '' : `${asWords(item)}: `;
      if (missing.length > 0) {
        return `${subject}cannot be checked without ${[...new Set(missing)].map(n => `"${n}"`).join(', ')} — pass ${missing.length === 1 ? 'it' : 'them'} in input.`;
      }
      const answer = await read(check.tool, readArgs);
      if (!answer.ok) {
        return `${subject}could not be checked (${check.tool}: ${answer.message}).`;
      }
      const found = valueAt(answer.data, check.expect.path);
      if (holds(check, found, scope)) {
        return null;
      }
      const words: TemplateArgs = { found: asWords(found) };
      for (const [name, path] of Object.entries(check.also)) {
        words[name] = asWords(valueAt(answer.data, path));
      }
      for (const [name, value] of Object.entries(scope)) {
        if (!(name in words)) {
          words[name] = asWords(value);
        }
      }
      const sentence = renderString(check.refuse, words, clock);
      return typeof sentence === 'string' ? sentence : check.refuse;
    }));
    refusals.push(...outcomes.filter((line): line is string => line !== null));
  }
  return refusals.length > 0 ? refusals.join(' ') : undefined;
}
