import type { DocumentedParameter, DocumentedResponse, HttpMethod, RouteOperation } from './types';
import ts from 'typescript';
import { HANDLER_NAMES } from './types';

/**
 * Read one `/api/v1` route file and say what it documents.
 *
 * The point of doing it this way — parsing the handlers instead of keeping a
 * hand-written spec beside them — is that the API changes weekly. A list
 * maintained by hand is wrong the first time someone adds an endpoint and
 * forgets; a list read out of the code is wrong only when the code is.
 *
 * What gets read, and from where:
 *
 * | In the spec | Comes from |
 * |---|---|
 * | path and path parameters | the file's location on disk |
 * | methods | the `export async function GET` declarations |
 * | summary and description | each handler's own doc comment |
 * | query parameters | the doc comment's `Query parameters:` bullets, plus `readPagination` |
 * | request body | whether the handler calls `readJsonBody`, and the field names it reads |
 * | error responses | the `jsonError(...)` calls in that handler, plus the shared helpers it uses |
 * | required capability | the string passed to `requireCapability` |
 *
 * So a new endpoint is documented the moment it is written, at whatever depth
 * its author wrote its doc comment, and a new query parameter shows up as soon
 * as it is described in the comment the way every existing one already is.
 */

/** Doc comments in this codebase open with a line like `GET /api/v1/reviews  { workerId }`. */
const HANDLER_SIGNATURE_LINE = /^(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*/;

/** A body hint on the signature line, as in `POST /api/v1/x  { workerId }`. */
const SIGNATURE_BODY_HINT = /^\s*\{[^}]*\}/;

/** What separates a one-line comment's signature from the sentence after it. */
const SIGNATURE_TRAILER = /^[\s:—–-]+/;

/** Every doc comment in a file, with its `@`-tag lines cut off. */
const DOC_COMMENT_BLOCK = /\/\*\*([\s\S]*?)\*\//g;

/** `Query parameters:` — the heading the route doc comments use before their bullets. */
const QUERY_HEADING = /^query\s+param(?:eter)?s?:\s*$/i;

/** A list bullet: the doc comments describe each parameter as one. */
const BULLET_PREFIX = /^[-*]\s+/;

/** What separates the names a bullet opens with from the description that follows. */
const NAME_DESCRIPTION_SEPARATOR = /\s[—–-]\s/;

/** A bullet's opening run of backticked names, and nothing else. */
const NAME_LIST_ONLY = /^(?:`[\w[\]]+`[,\s]*)+$/;

/** One backticked name inside a bullet's name list. */
const BACKTICKED_NAME = /`([\w[\]]+)`/g;

/** Shared helpers that turn a service error into the standard envelope. */
const ERROR_MAPPER_NAME = /ErrorResponse$/;

/** Body readers used across `/api/v1`: `str(body, 'workerId')` and friends. */
const BODY_READER_NAMES = new Set(['str', 'num', 'bool', 'arr', 'obj', 'int']);

/** The longest summary worth showing in a list of endpoints. */
const MAX_SUMMARY_LENGTH = 160;

/**
 * Turn a route file's path into its OpenAPI path template.
 * @param relativePath - Path of the route file below `src/app/api/v1`, e.g. `worker-runs/[id]/claim/route.ts`.
 */
export function routeFileToApiPath(relativePath: string): string {
  const segments = relativePath
    .split('/')
    .slice(0, -1)
    .map(segmentToPathTemplate);
  return `/api/v1${segments.length > 0 ? `/${segments.join('/')}` : ''}`;
}

/**
 * Turn one directory name into a path segment: `[id]` is a parameter, anything
 * else is a literal.
 * @param segment - One directory name from the route file's path.
 */
function segmentToPathTemplate(segment: string): string {
  const dynamic = /^\[(?:\.{3})?(\w+)\]$/.exec(segment);
  return dynamic ? `{${dynamic[1]}}` : segment;
}

/**
 * A stable id for one operation, unique across the spec because a path and a
 * method only pair up once.
 * @param method - The HTTP method, lowercased.
 * @param apiPath - The OpenAPI path template.
 */
export function operationIdFor(method: HttpMethod, apiPath: string): string {
  const slug = apiPath
    .replace(/^\/api\/v1\/?/, '')
    .replace(/[{}]/g, '')
    .replace(/[^A-Z0-9]+/gi, '_')
    .replace(/^_|_$/g, '');
  return slug === '' ? `${method}_root` : `${method}_${slug}`;
}

/**
 * The tag an operation is grouped under on the docs page: its first path
 * segment, which is also how the API itself is organised.
 * @param apiPath - The OpenAPI path template.
 */
export function tagFor(apiPath: string): string {
  const rest = apiPath.replace(/^\/api\/v1\/?/, '');
  const first = rest.split('/')[0] ?? '';
  return first === '' ? 'root' : first;
}

/**
 * Every node in a subtree, parents before children.
 *
 * TypeScript hands children out through a callback; collecting them into an
 * explicit list keeps the callers plain loops rather than nested visitors.
 * @param root - The node to walk.
 */
function nodesWithin(root: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const pending: ts.Node[] = [root];
  while (pending.length > 0) {
    const current = pending.pop() as ts.Node;
    found.push(current);
    ts.forEachChild(current, child => void pending.push(child));
  }
  return found;
}

/**
 * The exported handler declarations in a route file, keyed by method name.
 * @param sourceFile
 */
function exportedHandlers(sourceFile: ts.SourceFile): Map<string, ts.FunctionDeclaration> {
  const handlers = new Map<string, ts.FunctionDeclaration>();
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) {
      continue;
    }
    const name = statement.name.text;
    if (!HANDLER_NAMES.includes(name as (typeof HANDLER_NAMES)[number])) {
      continue;
    }
    const isExported = ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export;
    if (isExported) {
      handlers.set(name, statement);
    }
  }
  return handlers;
}

/**
 * The handler's doc comment as plain text, with the `@param` tags dropped.
 * @param handler
 */
function docCommentOf(handler: ts.FunctionDeclaration): string {
  const blocks = ts.getJSDocCommentsAndTags(handler).filter(ts.isJSDoc);
  const last = blocks.at(-1);
  if (!last) {
    return '';
  }
  return (ts.getTextOfJSDocComment(last.comment) ?? '').trim();
}

/**
 * Split a doc comment into the one-line summary and the rest.
 *
 * The first line is the handler's signature (`POST /api/v1/…`), which the spec
 * already knows, so it is dropped rather than repeated as the summary.
 * @param docComment - The handler's doc comment, tags removed.
 */
function summaryAndDescription(docComment: string): { summary: string; description: string } {
  const lines = docComment.split('\n');
  const start = lines.findIndex(line => line.trim() !== '');
  if (start === -1) {
    return { summary: '', description: '' };
  }
  const signature = HANDLER_SIGNATURE_LINE.exec(lines[start]!.trim());
  if (!signature) {
    const description = lines.slice(start).join('\n').trim();
    return { summary: firstSentenceOf(description), description };
  }
  // A one-line comment says everything after the signature on that same line,
  // so dropping the line whole would throw the only sentence away.
  const trailer = trailingSentenceOf(lines[start]!.trim().slice(signature[0].length));
  const description = [trailer, ...lines.slice(start + 1)].join('\n').trim();
  return { summary: firstSentenceOf(description), description };
}

/**
 * What a signature line says after the method and path, with the body hint and
 * the dash that introduces it removed.
 * @param remainder - The signature line after its method and path.
 */
function trailingSentenceOf(remainder: string): string {
  return remainder.replace(SIGNATURE_BODY_HINT, '').replace(SIGNATURE_TRAILER, '').trim();
}

/**
 * The doc comments in a file that open with a handler signature, keyed by
 * method.
 *
 * A few route files carry the endpoint's documentation just above a helper
 * rather than above the handler, where TypeScript does not attach it to
 * anything the handler can be asked for. The prose is right there and says
 * which endpoint it is about, so it is read from the file's text instead of
 * being lost.
 * @param source - The route file's source.
 */
function signedDocCommentsIn(source: string): Map<string, string> {
  const byMethod = new Map<string, string>();
  for (const block of source.matchAll(DOC_COMMENT_BLOCK)) {
    const text = stripCommentMarkers(block[1]!);
    const firstLine = text.split('\n').find(line => line.trim() !== '')?.trim() ?? '';
    const signature = HANDLER_SIGNATURE_LINE.exec(firstLine);
    if (!signature) {
      continue;
    }
    const method = firstLine.split(/\s/)[0]!;
    if (!byMethod.has(method)) {
      byMethod.set(method, text);
    }
  }
  return byMethod;
}

/**
 * A comment block's text: no leading asterisks, no `@param` tail.
 * @param raw
 */
function stripCommentMarkers(raw: string): string {
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    const cleaned = line.replace(/^\s*\*\s?/, '');
    if (cleaned.trim().startsWith('@')) {
      break;
    }
    lines.push(cleaned);
  }
  return lines.join('\n').trim();
}

/**
 * The first sentence of a description, for the one-line summary.
 *
 * Endpoint prose in this codebase opens with what the endpoint is, then
 * qualifies it over several paragraphs, so the first sentence is the useful
 * line and everything after it is detail the reader opens the endpoint for.
 * @param description - The handler's description, Markdown.
 */
function firstSentenceOf(description: string): string {
  const paragraph = description.split(/\n\s*\n/)[0] ?? '';
  const flattened = paragraph.replace(/\s+/g, ' ').trim();
  const sentenceEnd = /[.!?](?:\s|$)/.exec(flattened);
  const sentence = sentenceEnd ? flattened.slice(0, sentenceEnd.index + 1) : flattened;
  return sentence.length > MAX_SUMMARY_LENGTH ? `${sentence.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…` : sentence;
}

/**
 * Read one parameter bullet: the names it opens with, and what it says about
 * them.
 *
 * Split by hand rather than by one regex — a pattern that allows optional
 * spaces on both sides of the separator and then takes the rest of the line
 * can be made to backtrack, and this runs over every line of every doc comment
 * in the API.
 * @param line - One trimmed line of a doc comment.
 */
function parseParameterBullet(line: string): { names: string[]; description: string } | null {
  if (!BULLET_PREFIX.test(line)) {
    return null;
  }
  const body = line.replace(BULLET_PREFIX, '');
  const separator = NAME_DESCRIPTION_SEPARATOR.exec(body);
  const namePart = separator ? body.slice(0, separator.index) : body;
  const description = separator ? body.slice(separator.index + separator[0].length) : '';
  if (!NAME_LIST_ONLY.test(namePart.trim())) {
    return null;
  }
  const names = [...namePart.matchAll(BACKTICKED_NAME)].map(match => match[1]!);
  return names.length === 0 ? null : { names, description: description.trim() };
}

/**
 * The query parameters a handler's doc comment describes.
 *
 * Reads the `Query parameters:` bullet list the route files already keep, so
 * describing a new parameter the way the others are described is all it takes
 * to document it. Indented continuation lines belong to the bullet above them.
 * @param docComment - The handler's doc comment, tags removed.
 */
export function queryParametersFromDoc(docComment: string): DocumentedParameter[] {
  const parameters: DocumentedParameter[] = [];
  let inList = false;
  let lastBulletSize = 0;
  for (const raw of docComment.split('\n')) {
    const line = raw.trim();
    if (QUERY_HEADING.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) {
      continue;
    }
    const bullet = parseParameterBullet(line);
    if (bullet) {
      const { names, description } = bullet;
      for (const name of names) {
        parameters.push({ name, in: 'query', required: false, description, schema: { type: 'string' } });
      }
      lastBulletSize = names.length;
      continue;
    }
    const previous = parameters.at(-1);
    if (line !== '' && previous && /^\s{2,}/.test(raw)) {
      // A continuation line belongs to every parameter the bullet above named.
      for (const parameter of parameters.slice(parameters.length - lastBulletSize)) {
        parameter.description = `${parameter.description} ${line}`.trim();
      }
      continue;
    }
    if (line === '') {
      continue;
    }
    // A non-indented line that is not a bullet ends the list.
    inList = false;
  }
  return parameters;
}

/**
 * The path parameters named by an OpenAPI path template.
 * @param apiPath
 */
function pathParametersFrom(apiPath: string): DocumentedParameter[] {
  return [...apiPath.matchAll(/\{(\w+)\}/g)].map(match => ({
    name: match[1]!,
    in: 'path' as const,
    required: true,
    description: `The ${match[1]} from the URL.`,
    schema: { type: match[1] === 'id' || match[1] === 'runId' || match[1] === 'ruleId' ? 'integer' as const : 'string' as const },
  }));
}

/**
 * Every call expression inside a handler, with its callee spelled out as text.
 * @param handler
 */
function callsWithin(handler: ts.FunctionDeclaration): { name: string; call: ts.CallExpression }[] {
  const calls: { name: string; call: ts.CallExpression }[] = [];
  for (const node of nodesWithin(handler)) {
    if (!ts.isCallExpression(node)) {
      continue;
    }
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      calls.push({ name: callee.text, call: node });
    } else if (ts.isPropertyAccessExpression(callee)) {
      calls.push({ name: `${callee.expression.getText()}.${callee.name.text}`, call: node });
    }
  }
  return calls;
}

/**
 * The literal string an argument holds, or null when it is computed.
 * @param call
 * @param index
 */
function stringArgument(call: ts.CallExpression, index: number): string | null {
  const argument = call.arguments[index];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

/**
 * The literal number an argument holds, or null when it is computed.
 * @param call
 * @param index
 */
function numberArgument(call: ts.CallExpression, index: number): number | null {
  const argument = call.arguments[index];
  return argument && ts.isNumericLiteral(argument) ? Number(argument.text) : null;
}

/**
 * The `status:` of an options object literal argument, when it is a literal.
 * @param call
 * @param index
 */
function statusFromOptions(call: ts.CallExpression, index: number): number | null {
  const options = call.arguments[index];
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return null;
  }
  for (const property of options.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === 'status' && ts.isNumericLiteral(property.initializer)) {
      return Number(property.initializer.text);
    }
  }
  return null;
}

/**
 * The responses a handler can send.
 *
 * Success statuses come from its `NextResponse` calls, error statuses from its
 * own `jsonError(...)` calls plus the shared helpers it delegates to — a
 * handler that calls `authApi` can answer 401 whether or not it says so.
 * @param handler - The exported handler declaration.
 */
function responsesOf(handler: ts.FunctionDeclaration): DocumentedResponse[] {
  const calls = callsWithin(handler);
  const called = new Set(calls.map(entry => entry.name));
  const byStatus = new Map<number, Set<string>>();

  for (const { name, call } of calls) {
    if (name === 'jsonError') {
      const status = numberArgument(call, 2);
      const code = stringArgument(call, 0);
      if (status !== null) {
        addErrorCode(byStatus, status, code);
      }
    }
  }
  if (called.has('authApi')) {
    addErrorCode(byStatus, 401, 'UNAUTHORIZED');
  }
  if (called.has('requireCapability')) {
    addErrorCode(byStatus, 403, 'FORBIDDEN');
  }
  if (called.has('readJsonBody') || called.has('readIdParam')) {
    addErrorCode(byStatus, 400, 'VALIDATION_FAILED');
  }

  const successStatus = successStatusOf(calls);
  const responses: DocumentedResponse[] = [
    { status: successStatus, description: 'Success.', errorCodes: [] },
  ];
  for (const [status, codes] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    responses.push({ status, description: describeStatus(status), errorCodes: [...codes].sort() });
  }
  return responses;
}

/**
 * Record one `error.code` seen at a status.
 * @param byStatus
 * @param status
 * @param code
 */
function addErrorCode(byStatus: Map<number, Set<string>>, status: number, code: string | null): void {
  const existing = byStatus.get(status) ?? new Set<string>();
  if (code) {
    existing.add(code);
  }
  byStatus.set(status, existing);
}

/**
 * The success status a handler returns — 200 unless it says otherwise.
 * @param calls
 */
function successStatusOf(calls: { name: string; call: ts.CallExpression }[]): number {
  for (const { name, call } of calls) {
    const status = name === 'NextResponse.json' ? statusFromOptions(call, 1) : null;
    if (status !== null && status < 400) {
      return status;
    }
  }
  return 200;
}

/**
 * Plain English for a status code, for readers who do not have them memorised.
 * @param status
 */
function describeStatus(status: number): string {
  const wording: Record<number, string> = {
    400: 'The request was malformed or failed validation.',
    401: 'The bearer token or session was missing or invalid.',
    402: 'The agent is over its budget.',
    403: 'The caller is authenticated but not allowed to do this.',
    404: 'No such record in this organization.',
    409: 'The record is in a state that does not allow this.',
    422: 'The request was understood but could not be processed.',
    500: 'Something failed on our side.',
  };
  return wording[status] ?? 'Error.';
}

/**
 * The capability strings a handler enforces, sorted.
 * @param handler
 */
function capabilitiesOf(handler: ts.FunctionDeclaration): string[] {
  const capabilities = new Set<string>();
  for (const { name, call } of callsWithin(handler)) {
    if (name !== 'requireCapability') {
      continue;
    }
    const capability = stringArgument(call, 1);
    if (capability) {
      capabilities.add(capability);
    }
  }
  return [...capabilities].sort();
}

/**
 * The request body field names a handler reads.
 *
 * Handlers pull fields two ways — `str(body, 'workerId')` through the shared
 * readers, or `body.workerId` directly — so both are collected. The result is
 * the field list, not their types: what a field must contain is in the prose.
 * @param handler - The exported handler declaration.
 */
function bodyFieldsOf(handler: ts.FunctionDeclaration): string[] {
  const fields = new Set<string>();
  for (const { name, call } of callsWithin(handler)) {
    if (!BODY_READER_NAMES.has(name)) {
      continue;
    }
    const target = call.arguments[0];
    const field = stringArgument(call, 1);
    if (field && target && ts.isIdentifier(target) && target.text === 'body') {
      fields.add(field);
    }
  }
  for (const node of nodesWithin(handler)) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'body') {
      fields.add(node.name.text);
    }
  }
  return [...fields].sort();
}

/**
 * Read every operation out of one route file.
 * @param source - The route file's TypeScript source.
 * @param apiPath - The OpenAPI path template the file serves.
 */
export function parseRouteModule(source: string, apiPath: string): RouteOperation[] {
  const sourceFile = ts.createSourceFile('route.ts', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const handlers = exportedHandlers(sourceFile);
  const signedComments = signedDocCommentsIn(source);
  const operations: RouteOperation[] = [];

  for (const handlerName of HANDLER_NAMES) {
    const handler = handlers.get(handlerName);
    if (!handler) {
      continue;
    }
    const method = handlerName.toLowerCase() as HttpMethod;
    const docComment = docCommentOf(handler) || signedComments.get(handlerName) || '';
    const { summary, description } = summaryAndDescription(docComment);
    const called = new Set(callsWithin(handler).map(entry => entry.name));
    const parameters = [...pathParametersFrom(apiPath), ...queryParametersFromDoc(docComment)];
    if (called.has('readPagination')) {
      appendPaginationParameters(parameters);
    }
    operations.push({
      method,
      path: apiPath,
      operationId: operationIdFor(method, apiPath),
      tag: tagFor(apiPath),
      summary: summary === '' ? `${handlerName} ${apiPath}` : summary,
      description,
      parameters,
      requiresBody: called.has('readJsonBody'),
      requestBodyFields: bodyFieldsOf(handler),
      capabilities: capabilitiesOf(handler),
      delegatesErrorMapping: [...called].some(name => ERROR_MAPPER_NAME.test(name)),
      responses: responsesOf(handler),
    });
  }
  return operations;
}

/**
 * Add `limit` and `offset` for a handler that pages, unless its doc comment
 * already described them.
 * @param parameters - The parameter list to extend, edited in place.
 */
function appendPaginationParameters(parameters: DocumentedParameter[]): void {
  const named = new Set(parameters.map(parameter => parameter.name));
  if (!named.has('limit')) {
    parameters.push({
      name: 'limit',
      in: 'query',
      required: false,
      description: 'How many records to return. Defaults to 50, capped at 200.',
      schema: { type: 'integer' },
    });
  }
  if (!named.has('offset')) {
    parameters.push({
      name: 'offset',
      in: 'query',
      required: false,
      description: 'How many records to skip. Defaults to 0.',
      schema: { type: 'integer' },
    });
  }
}
