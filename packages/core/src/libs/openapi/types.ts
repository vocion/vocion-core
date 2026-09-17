/**
 * The shapes the OpenAPI generator passes around.
 *
 * The generator reads the route handlers themselves rather than a
 * hand-maintained list, so these types describe *what can be learned from a
 * route file*: its methods, the parameters its doc comment names, the error
 * codes it actually emits. Anything that cannot be read out of the source is
 * deliberately absent — a spec that guesses is worse than one that is thin.
 */

/** The HTTP methods a Next.js route file may export, lowercased for OpenAPI. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** The exported handler names Next.js recognises, in the order they should appear. */
export const HANDLER_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** One path or query parameter, as OpenAPI wants it. */
export type DocumentedParameter = {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description: string;
  schema: { type: 'string' | 'integer' };
};

/** One response an operation can send. */
export type DocumentedResponse = {
  /** HTTP status code. */
  status: number;
  /** What the status means for this endpoint. */
  description: string;
  /**
   * The `error.code` values seen at this status in the handler's own
   * `jsonError(...)` calls. Empty for success responses.
   */
  errorCodes: string[];
};

/** Everything the generator could learn about one exported handler. */
export type RouteOperation = {
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/v1/worker-runs/{id}/claim`. */
  path: string;
  /** Stable id built from method and path, e.g. `post_worker-runs_id_claim`. */
  operationId: string;
  /** The first path segment under `/api/v1`, used to group the docs page. */
  tag: string;
  /** One line, taken from the handler's doc comment. */
  summary: string;
  /** The rest of the doc comment, as Markdown. Empty when there is none. */
  description: string;
  parameters: DocumentedParameter[];
  /** True when the handler parses a JSON request body. */
  requiresBody: boolean;
  /** Body fields the handler reads by name. Sorted; may be empty. */
  requestBodyFields: string[];
  /** Capability strings passed to `requireCapability`, sorted. */
  capabilities: string[];
  /**
   * True when the handler hands service failures to a shared error mapper
   * rather than calling `jsonError` itself — its `responses` then list the
   * failures it raises directly, and the mapper can add others.
   */
  delegatesErrorMapping: boolean;
  responses: DocumentedResponse[];
};

/**
 * The generated document. Typed loosely on purpose: this is JSON handed to a
 * viewer and to client tooling, and pinning every OpenAPI keyword here would
 * be a second spec to maintain.
 */
export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  components: Record<string, unknown>;
  paths: Record<string, Record<string, unknown>>;
};
