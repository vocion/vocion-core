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
 *      dropped — the key is not sent, the query parameter is not appended.
 *
 * A path is stricter: a placeholder there is a path parameter, and an
 * endpoint cannot be called without one, so `renderPath` reports the missing
 * names instead of guessing at a URL.
 */

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
 * text otherwise, `undefined` when nothing it named was supplied.
 * @param template - The string as declared.
 * @param args - The validated input.
 */
export function renderString(template: string, args: TemplateArgs): unknown {
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
 * @param value - The template: strings, numbers, booleans, arrays and objects.
 * @param args - The validated input.
 */
export function renderTemplate(value: unknown, args: TemplateArgs): unknown {
  if (typeof value === 'string') {
    return renderString(value, args);
  }
  if (Array.isArray(value)) {
    return value.map(entry => renderTemplate(entry, args)).filter(entry => entry !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const rendered = renderTemplate(entry, args);
      if (rendered !== undefined) {
        out[key] = rendered;
      }
    }
    return out;
  }
  return value;
}

/**
 * The query string a declared `query` map produces: each value rendered, the
 * parameters that resolved to nothing left out.
 * @param query - The declared map of parameter name to template.
 * @param args - The validated input.
 */
export function renderQuery(query: Record<string, string>, args: TemplateArgs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, template] of Object.entries(query)) {
    const rendered = renderString(template, args);
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
 * @param path - The declared path, e.g. `/api/projects/{documentId}`.
 * @param args - The validated input.
 */
export function renderPath(path: string, args: TemplateArgs): RenderedPath {
  const missing = placeholdersIn(path).filter(name => !present(args[name]));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    path: path.replace(PLACEHOLDER, (_match, name: string) => encodeURIComponent(argAsText(args[name]))),
  };
}
