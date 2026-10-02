/**
 * `{argName}` templating for a `rest` source's paths, query strings, bodies
 * and review-card hints, filled from an endpoint's validated input.
 *
 * Three rules, and the whole contract is these three:
 *
 *   1. A string that is exactly one placeholder — `"{dueDate}"`, `"{count}"` —
 *      resolves to the argument's own value, type intact. That is how a number
 *      or a boolean survives into a JSON body instead of arriving quoted.
 *   2. A placeholder whose argument was not supplied resolves to nothing. A
 *      lone placeholder becomes `undefined`; a mixed string whose every
 *      placeholder is missing becomes `undefined` too (so a review row
 *      "Due: {dueDate}" vanishes rather than reading "Due: "); a mixed string
 *      with some arguments present renders the missing ones as empty.
 *   3. Inside an object or an array, an entry that resolved to `undefined` is
 *      dropped — the key is not sent, the query parameter is not appended —
 *      and an object whose every entry dropped is dropped with them.
 *
 * A path is stricter: a placeholder there is a path parameter, and an
 * endpoint cannot be called without one, so `renderPath` reports the missing
 * names instead of guessing at a URL.
 *
 * Beside the input placeholders there are BUILT-IN dates — `{$today}`,
 * `{$today-7d}`, `{$monthStart}` … — resolved on the server in the
 * workspace's zone at call time, so a template can say "the last seven days"
 * and the model never does date arithmetic. They are not inputs and never
 * reach a tool's schema.
 */

import { dayKey, dayPlus, DEFAULT_TIME_ZONE, resolveTimeZone } from '@/libs/time/zone';

/** A placeholder: `{name}`, with the same name rules as an input property. */
const PLACEHOLDER = /\{([a-z_]\w*)\}/gi;

/** The argument bag a template is filled from. */
export type TemplateArgs = Record<string, unknown>;

/**
 * The placeholder names a template string refers to, in order, once each.
 * @param template - A string that may carry `{name}` placeholders.
 */
export function placeholdersIn(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Every placeholder in a JSON-shaped template — strings at any depth.
 * @param value - A template body, review hint, or query map.
 */
export function placeholdersInTemplate(value: unknown): string[] {
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const name of placeholdersIn(node)) {
        names.add(name);
      }
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return [...names];
}

/**
 * Whether an argument counts as supplied. `null` is treated as absent, like an omitted optional.
 * @param value - The argument as the validated input holds it.
 */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/* ------------------------------------------------------------------ */
/* Built-in dates — `{$today}`, `{$today-7d}`, `{$monthStart}` …       */
/* ------------------------------------------------------------------ */

/**
 * A built-in placeholder: `{$name}` or `{$today±Nd}`. Resolved on the server,
 * in the workspace's zone, at call time — never by the model. An agent must
 * not do date arithmetic, and an API takes absolute dates, so "the last
 * seven days" is written `{$today-7d}` in the template and the model passes
 * nothing. Built-ins are not inputs: they never appear in a tool's schema,
 * and `builtinPlaceholderProblems` refuses any other `{$…}` name at apply.
 */
const BUILTIN = /\{\$([a-z]+)(?:([+-])(\d+)d)?\}/gi;

/** Every `{$…}` shape, valid or not, for the apply-time check. */
const ANY_BUILTIN = /\{\$([^}]*)\}/g;

/** The names a built-in may take. Only `today` takes a `±Nd` offset. */
type BuiltinName = 'today' | 'monthStart' | 'monthEnd' | 'weekStart';

/** What a built-in resolves against: the instant, and the zone whose calendar day counts. */
export type TemplateClock = { now: Date; timeZone: string };

/**
 * The clock a render uses when the caller passes none: now, in UTC.
 */
function utcNow(): TemplateClock {
  return { now: new Date(), timeZone: DEFAULT_TIME_ZONE };
}

/**
 * The calendar values every built-in reads from, for one clock.
 * @param clock - The instant and zone.
 */
function calendarOf(clock: TemplateClock): Record<BuiltinName, string> {
  const today = dayKey(clock.now, resolveTimeZone(clock.timeZone));
  const [year, month] = today.split('-').map(Number) as [number, number, number];
  const monthStart = `${today.slice(0, 8)}01`;
  // Day 0 of the next month is the last day of this one.
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  // getUTCDay: 0 is Sunday; the week starts on Monday.
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { today, monthStart, monthEnd, weekStart: dayPlus(today, -sinceMonday) };
}

/**
 * Every `{$…}` in a template that is not a built-in this file resolves,
 * as sentences for the apply.
 * @param value - A template: a string, or JSON-shaped.
 */
export function builtinPlaceholderProblems(value: unknown): string[] {
  const problems: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(ANY_BUILTIN)) {
        const inner = match[1]!;
        const ok = /^(?:today(?:[+-]\d+d)?|monthStart|monthEnd|weekStart)$/.test(inner);
        if (!ok) {
          problems.push(`{$${inner}} is not a built-in placeholder (built-ins: {$today}, {$today-7d}, {$today+30d}, {$monthStart}, {$monthEnd}, {$weekStart})`);
        }
      }
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return problems;
}

/**
 * A string with its built-ins replaced by `YYYY-MM-DD` dates. Input
 * placeholders are left for `renderString`.
 * @param template - The string as declared.
 * @param clock - The instant and zone to resolve against.
 */
export function resolveBuiltins(template: string, clock: TemplateClock = utcNow()): string {
  if (!template.includes('{$')) {
    return template;
  }
  const calendar = calendarOf(clock);
  return template.replace(BUILTIN, (match, name: string, sign: string | undefined, days: string | undefined) => {
    const base = calendar[name as BuiltinName];
    if (base === undefined) {
      return match;
    }
    if (sign && days) {
      return name === 'today' ? dayPlus(base, (sign === '-' ? -1 : 1) * Number(days)) : match;
    }
    return base;
  });
}

/**
 * An argument as it reads inside a longer string or a URL.
 * @param value - A supplied argument.
 */
export function argAsText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(argAsText).join(',');
  }
  return JSON.stringify(value);
}

/**
 * One string template filled in — the value itself for a lone placeholder,
 * text otherwise, `undefined` when nothing it named was supplied. Built-in
 * dates are resolved first, so `{$today}` reads as a plain date.
 * @param raw - The string as declared.
 * @param args - The validated input.
 * @param clock - The instant and zone built-ins resolve against; now in UTC when omitted.
 */
export function renderString(raw: string, args: TemplateArgs, clock?: TemplateClock): unknown {
  const template = resolveBuiltins(raw, clock);
  const names = placeholdersIn(template);
  if (names.length === 0) {
    return template;
  }
  const lone = /^\{([a-z_]\w*)\}$/i.exec(template);
  if (lone) {
    const value = args[lone[1]!];
    return present(value) ? value : undefined;
  }
  if (!names.some(name => present(args[name]))) {
    return undefined;
  }
  return template.replace(PLACEHOLDER, (_match, name: string) => (present(args[name]) ? argAsText(args[name]) : ''));
}

/**
 * A JSON-shaped template filled in, with entries that resolved to nothing
 * dropped — the shape a request body or a review hint is rendered from.
 *
 * An object whose every entry dropped is itself dropped, recursively:
 * `priority: { name: '{priority}' }` with no priority must not send
 * `priority: {}`, which an API reads as "set priority to nothing". A literal
 * `{}` in the template had no entries to lose and is kept. Arrays are not
 * pruned — an empty list is a value.
 * @param value - The template: strings, numbers, booleans, arrays and objects.
 * @param args - The validated input.
 * @param clock - The instant and zone built-ins resolve against.
 */
export function renderTemplate(value: unknown, args: TemplateArgs, clock?: TemplateClock): unknown {
  if (typeof value === 'string') {
    return renderString(value, args, clock);
  }
  if (Array.isArray(value)) {
    return value.map(entry => renderTemplate(entry, args, clock)).filter(entry => entry !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      const rendered = renderTemplate(entry, args, clock);
      if (rendered !== undefined) {
        out[key] = rendered;
      }
    }
    return entries.length > 0 && Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}

/**
 * The query string a declared `query` map produces: each value rendered, the
 * parameters that resolved to nothing left out.
 * @param query - The declared map of parameter name to template.
 * @param args - The validated input.
 * @param clock - The instant and zone built-ins resolve against.
 */
export function renderQuery(query: Record<string, string>, args: TemplateArgs, clock?: TemplateClock): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, template] of Object.entries(query)) {
    const rendered = renderString(template, args, clock);
    if (rendered !== undefined) {
      out[key] = argAsText(rendered);
    }
  }
  return out;
}

/** A rendered path, or the path parameters that stop it being rendered. */
export type RenderedPath = { ok: true; path: string } | { ok: false; missing: string[] };

/**
 * A declared path with its parameters substituted and URL-encoded. A
 * parameter that was not supplied is reported rather than rendered, because
 * `/api/projects/` is a different endpoint from `/api/projects/{id}`.
 * @param raw - The declared path, e.g. `/api/projects/{documentId}`.
 * @param args - The validated input.
 * @param clock - The instant and zone built-ins resolve against.
 */
export function renderPath(raw: string, args: TemplateArgs, clock?: TemplateClock): RenderedPath {
  const path = resolveBuiltins(raw, clock);
  const missing = placeholdersIn(path).filter(name => !present(args[name]));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    path: path.replace(PLACEHOLDER, (_match, name: string) => encodeURIComponent(argAsText(args[name]))),
  };
}
