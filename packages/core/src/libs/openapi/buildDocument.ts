import type { OpenApiDocument, RouteOperation } from './types';

/**
 * Assemble the OpenAPI document from the operations read out of the route
 * files.
 *
 * Everything here is either constant (the error envelope, the security
 * schemes) or derived from {@link RouteOperation}. Nothing is invented: where
 * the generator could not learn a response's fields, the response says it is a
 * JSON object and the endpoint's prose carries the detail, rather than a
 * confident-looking schema nobody checked.
 */

/** What every `/api/v1` error body looks like, whatever went wrong. */
const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'A stable, machine-readable code such as VALIDATION_FAILED.' },
        message: { type: 'string', description: 'What went wrong, in English, for a developer reading a log.' },
        details: { type: ['object', 'null'], description: 'Extra context when the endpoint has any; null otherwise.' },
      },
    },
  },
} as const;

/** How the API describes itself at the top of the docs page. */
const API_DESCRIPTION = `
The HTTP API behind Vocion's dashboard. Every endpoint is scoped to one
organization — the credential decides which, and there is no way to ask for
another one's records.

**Authenticating.** Send \`Authorization: Bearer vcn_live_…\` with a tenant API
token, issued under Developers → API tokens. Calls made from a signed-in
browser session are accepted too, which is how the dashboard itself uses these
endpoints. When an \`Authorization\` header is present it is the credential: a
bad token is a 401 and never falls back to a cookie.

**Errors.** Every failure returns the same envelope, whatever the status:

\`\`\`json
{ "error": { "code": "VALIDATION_FAILED", "message": "workerId is required", "details": null } }
\`\`\`

**Paging.** List endpoints take \`limit\` (default 50, maximum 200) and
\`offset\`. Out-of-range values fall back to the defaults rather than erroring.

**How this document is made.** It is generated from the route handlers
themselves — their paths, their doc comments, the error codes they emit — by
\`npm run openapi:generate\`, and a test fails when it falls out of step with
the code. Request and response bodies are documented by their field names and
the endpoint's prose; they are not yet described field-by-field as schemas.
`.trim();

/**
 * Build the whole document.
 * @param operations - Every operation read from the route files.
 * @param version - The API version to publish, normally the package version.
 */
export function buildOpenApiDocument(operations: RouteOperation[], version: string): OpenApiDocument {
  const sorted = [...operations].sort(compareOperations);
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of sorted) {
    const existing = paths[operation.path] ?? {};
    existing[operation.method] = operationObject(operation);
    paths[operation.path] = existing;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Vocion API',
      version,
      description: API_DESCRIPTION,
    },
    servers: [{ url: '/', description: 'This deployment.' }],
    tags: tagsOf(sorted),
    components: {
      securitySchemes: {
        bearerToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'A tenant API token, issued under Developers → API tokens. Looks like `vcn_live_…`.',
        },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    paths,
  };
}

/**
 * Order operations by path, then by the usual method order, so diffs stay small.
 * @param left
 * @param right
 */
function compareOperations(left: RouteOperation, right: RouteOperation): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  return methodRank(left.method) - methodRank(right.method);
}

/**
 * Where a method sorts within one path.
 * @param method
 */
function methodRank(method: string): number {
  const order = ['get', 'post', 'put', 'patch', 'delete'];
  return order.indexOf(method);
}

/**
 * The tag list, one per first path segment, in the order they appear.
 * @param operations
 */
function tagsOf(operations: RouteOperation[]): { name: string; description: string }[] {
  const names = [...new Set(operations.map(operation => operation.tag))].sort();
  return names.map(name => ({ name, description: `Endpoints under /api/v1/${name}.` }));
}

/**
 * One OpenAPI operation object.
 * @param operation
 */
function operationObject(operation: RouteOperation): Record<string, unknown> {
  const object: Record<string, unknown> = {
    operationId: operation.operationId,
    summary: operation.summary,
    tags: [operation.tag],
    security: [{ bearerToken: [] }],
    responses: responsesObject(operation),
  };
  const description = descriptionWithCapability(operation);
  if (description !== '') {
    object.description = description;
  }
  if (operation.parameters.length > 0) {
    object.parameters = operation.parameters;
  }
  if (operation.requiresBody) {
    object.requestBody = requestBodyObject(operation);
  }
  if (operation.capabilities.length > 0) {
    object['x-required-capability'] = operation.capabilities;
  }
  return object;
}

/**
 * The description, with the capability requirement spelled out.
 *
 * A 403 with no explanation is the hardest failure to debug from the outside,
 * so the capability a token needs is stated where the reader is already
 * looking rather than left as an extension field.
 * @param operation - The operation being described.
 */
function descriptionWithCapability(operation: RouteOperation): string {
  const notes: string[] = [];
  if (operation.capabilities.length > 0) {
    const list = operation.capabilities.map(capability => `\`${capability}\``).join(', ');
    notes.push(`**Requires the ${list} capability.** A token without it is refused with 403, and so is a member whose role does not carry it.`);
  }
  if (operation.delegatesErrorMapping) {
    notes.push('This endpoint passes service failures — a conflict, a budget stop, a missing record — through the shared error mapper, so it can answer with statuses beyond the ones listed below. The envelope is the same either way.');
  }
  return [operation.description, ...notes].filter(part => part !== '').join('\n\n');
}

/**
 * The request body object, listing the fields the handler reads.
 * @param operation
 */
function requestBodyObject(operation: RouteOperation): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of operation.requestBodyFields) {
    properties[field] = { description: 'Read by this endpoint; see the description for what it must contain.' };
  }
  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          description: operation.requestBodyFields.length > 0
            ? 'The fields this endpoint reads.'
            : 'A JSON object. This endpoint reads its fields dynamically, so they are described in the prose above.',
          properties,
          additionalProperties: true,
        },
      },
    },
  };
}

/**
 * The responses object: one success, plus every error the handler can send.
 * @param operation
 */
function responsesObject(operation: RouteOperation): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const response of operation.responses) {
    const isError = response.status >= 400;
    responses[String(response.status)] = {
      description: isError ? describeErrorResponse(response.description, response.errorCodes) : response.description,
      content: {
        'application/json': {
          schema: isError ? { $ref: '#/components/schemas/Error' } : { type: 'object' },
        },
      },
    };
  }
  return responses;
}

/**
 * An error response's description, naming the codes it can carry.
 * @param description
 * @param errorCodes
 */
function describeErrorResponse(description: string, errorCodes: string[]): string {
  if (errorCodes.length === 0) {
    return description;
  }
  return `${description} Codes: ${errorCodes.map(code => `\`${code}\``).join(', ')}.`;
}
