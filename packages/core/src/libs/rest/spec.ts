/**
 * What a `rest` source declares — the contract behind `sources/<slug>.yaml`
 * with `kind: rest`, validated at apply.
 *
 * A REST source is a list of endpoints on one bearer-token API. Each entry
 * under `tools` becomes one live read tool for every agent that holds the
 * source (`services/agents/tools/restDirect.ts`); each entry under `actions`
 * is a write an agent can only reach through the `rest.request` action
 * (`libs/actions/rest.ts`), which rides the review queue and the trust
 * ladder like every other connector write. Nothing here names a product: the
 * paths, the arguments and the review wording all come from the workspace.
 *
 * Everything that can be wrong with a declaration is refused here, at apply,
 * with the entry named — a mistyped key (`.strict()`), an input schema
 * outside the supported subset, a `{placeholder}` that names no argument, two
 * tools with one name. An endpoint the apply accepted is one the tool builder
 * and the action can trust without checking again.
 */

import type { InputSchema } from './jsonSchema';
import { z } from 'zod';
import { EMPTY_INPUT_SCHEMA, inputPropertyNames, inputSchemaProblems } from './jsonSchema';
import { builtinPlaceholderProblems, placeholdersIn, placeholdersInTemplate } from './template';

/** The HTTP methods an endpoint may declare. */
export const REST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type RestMethod = (typeof REST_METHODS)[number];

/**
 * How much of a response reaches the model or the run when the endpoint sets
 * no `response.maxChars`. Past it the text is cut and says how long it was.
 */
export const REST_DEFAULT_MAX_CHARS = 40_000;

/** The one tool every REST source gets on top of its declared reads. */
export const REST_LIST_ACTIONS_TOOL = 'list_actions';

/** An endpoint or tool name: a snake_case identifier, so `<prefix>_<name>` is a valid tool name. */
const NameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case: lowercase letters, digits and underscores, starting with a letter');

/**
 * An input block, checked against the subset `libs/rest/jsonSchema.ts`
 * accepts, with every fault reported as its own issue.
 */
const InputSchemaSchema = z.custom<InputSchema>(() => true).superRefine((value, ctx) => {
  for (const problem of inputSchemaProblems(value, 'input')) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
});

const ResponseSchema = z.object({
  /** Dotted path into the JSON to return instead of the whole document, e.g. `data` or `data.items`. */
  pick: z.string().regex(/^[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*$/i, 'must be a dotted path of property names, e.g. data.items').optional(),
  /** Longest text handed back; past it the text is truncated and says so. */
  maxChars: z.number().int().positive().default(REST_DEFAULT_MAX_CHARS),
}).strict();

/** What a read tool and a write action share. */
const EndpointSchema = z.object({
  name: NameSchema,
  /** What the model reads to decide when to call it. Defaults to `<METHOD> <path>`. */
  description: z.string().optional(),
  method: z.enum(REST_METHODS),
  /** Path under the credential's base URL. `{param}` segments are substituted from the input. */
  path: z.string().regex(/^\//, 'must start with /'),
  /** The arguments, as the JSON Schema subset `libs/rest/jsonSchema.ts` accepts. */
  input: InputSchemaSchema.default(EMPTY_INPUT_SCHEMA),
  /** Query parameters: name to template. A parameter whose template resolves to nothing is left out. */
  query: z.record(z.string().min(1), z.string()).default({}),
  response: ResponseSchema.default({ maxChars: REST_DEFAULT_MAX_CHARS }),
});

export const RestToolSchema = EndpointSchema.strict();
export type RestTool = z.infer<typeof RestToolSchema>;

/** A row on the review card, templated from the input; a row whose value resolves to nothing is dropped. */
const ReviewFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
}).strict();

export const RestActionSchema = EndpointSchema.extend({
  /** The JSON body, as a template. Keys whose value resolves to nothing are dropped. */
  body: z.unknown().optional(),
  /** Whether the write can be put back by hand. `false` puts an Irreversible badge on the card. */
  reversible: z.boolean().default(false),
  /** Wording for the review card, templated from the input. */
  review: z.object({
    title: z.string().min(1).optional(),
    fields: z.array(ReviewFieldSchema).default([]),
  }).strict().optional(),
}).strict();
export type RestAction = z.infer<typeof RestActionSchema>;

export type RestEndpoint = RestTool | RestAction;

/**
 * Every placeholder an endpoint's templates use must name a declared
 * argument. Reported per endpoint, with the template that carries it.
 * @param endpoint - One parsed tool or action.
 * @param ctx - The refinement context to report on.
 * @param at - The entry's path in the config, for the issue.
 */
function refineEndpoint(endpoint: RestEndpoint, ctx: z.RefinementCtx, at: (string | number)[]): void {
  const declared = new Set(inputPropertyNames(endpoint.input));
  const check = (names: string[], where: string): void => {
    for (const name of names) {
      if (!declared.has(name)) {
        ctx.addIssue({ code: 'custom', path: at, message: `${endpoint.name}: ${where} uses {${name}}, which is not one of its input properties` });
      }
    }
  };
  check(placeholdersIn(endpoint.path), 'path');
  check(placeholdersInTemplate(endpoint.query), 'query');
  // `reversible` always parses on an action (it has a default); `body` may be absent.
  const isAction = 'reversible' in endpoint;
  if (isAction) {
    check(placeholdersInTemplate(endpoint.body), 'body');
    check(placeholdersInTemplate(endpoint.review ?? {}), 'review');
  }
  // A `{$…}` that is not a built-in date would reach the API verbatim.
  const templates = { path: endpoint.path, query: endpoint.query, ...(isAction ? { body: endpoint.body, review: endpoint.review } : {}) };
  for (const [where, template] of Object.entries(templates)) {
    for (const problem of builtinPlaceholderProblems(template)) {
      ctx.addIssue({ code: 'custom', path: at, message: `${endpoint.name}: ${where} — ${problem}` });
    }
  }
  // A required path parameter cannot be optional: the endpoint cannot be
  // called without it, and `renderPath` would refuse every call.
  const required = new Set(endpoint.input.required ?? []);
  for (const name of placeholdersIn(endpoint.path)) {
    if (declared.has(name) && !required.has(name)) {
      ctx.addIssue({ code: 'custom', path: at, message: `${endpoint.name}: path parameter {${name}} must be listed under input.required` });
    }
  }
}

/**
 * The config a `rest` source carries. Validated when the workspace is
 * applied (`libs/sources/upsert.ts`), and again from the stored row by
 * `restConfigOf` before any tool is built from it.
 */
export const restConfigSchema = z.object({
  /**
   * The first word of every tool name. Defaults to the source slug with `-`
   * turned into `_`, so a source `billing-api` offers `billing_api_<name>`.
   */
  toolPrefix: z.string().regex(/^[a-z][\w-]*$/i, 'must be letters, digits, underscores or dashes, starting with a letter').optional(),
  /** The path Test connection GETs. Any 2xx counts. */
  healthPath: z.string().regex(/^\//, 'must start with /').default('/'),
  /** Live READ endpoints — one agent tool each. */
  tools: z.array(RestToolSchema).default([]),
  /** WRITE endpoints — reachable only through the `rest.request` action. */
  actions: z.array(RestActionSchema).default([]),
}).superRefine((config, ctx) => {
  const seenTools = new Set<string>();
  config.tools.forEach((tool, i) => {
    if (tool.name === REST_LIST_ACTIONS_TOOL) {
      ctx.addIssue({ code: 'custom', path: ['tools', i, 'name'], message: `"${REST_LIST_ACTIONS_TOOL}" is reserved: every REST source gets that tool` });
    }
    if (seenTools.has(tool.name)) {
      ctx.addIssue({ code: 'custom', path: ['tools', i, 'name'], message: `two tools are named "${tool.name}"` });
    }
    seenTools.add(tool.name);
    refineEndpoint(tool, ctx, ['tools', i]);
  });
  const seenActions = new Set<string>();
  config.actions.forEach((action, i) => {
    if (seenActions.has(action.name)) {
      ctx.addIssue({ code: 'custom', path: ['actions', i, 'name'], message: `two actions are named "${action.name}"` });
    }
    seenActions.add(action.name);
    refineEndpoint(action, ctx, ['actions', i]);
  });
});

export type RestConfig = z.infer<typeof restConfigSchema>;

/** One REST source as the tool builder and the action see it. */
export type RestSourceSpec = {
  /** The knowledge_source row. */
  id: number;
  /** The source slug — what an agent's `connectorSources` names and `rest.request` takes. */
  slug: string;
  /** The display name from the manifest, or the slug. */
  name: string;
  config: RestConfig;
};

/**
 * The parsed config behind a stored source row, or null when the row does
 * not hold a valid REST config — a row written before a schema change, or
 * by hand with nothing declared yet. The reserved `_` keys the writer adds
 * are stripped by the schema, which only reads what it declares.
 * @param configJson - The row's `config_json`.
 */
export function restConfigOf(configJson: Record<string, unknown> | null | undefined): RestConfig | null {
  const parsed = restConfigSchema.safeParse(configJson ?? {});
  return parsed.success ? parsed.data : null;
}

/**
 * The first word of every tool a source offers.
 * @param slug - The source slug.
 * @param config - Its config, which may set `toolPrefix`.
 */
export function toolPrefixFor(slug: string, config: Pick<RestConfig, 'toolPrefix'>): string {
  return (config.toolPrefix ?? slug).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * A tool's full name: `<prefix>_<name>`, cut to the 64 characters a provider allows.
 * @param prefix - From `toolPrefixFor`.
 * @param name - The endpoint's name.
 */
export function restToolName(prefix: string, name: string): string {
  return `${prefix}_${name}`.slice(0, 64);
}

/**
 * The description the model reads for an endpoint that declared none.
 * @param endpoint - One tool or action.
 */
export function endpointDescription(endpoint: RestEndpoint): string {
  return endpoint.description?.trim() || `${endpoint.method} ${endpoint.path}`;
}
