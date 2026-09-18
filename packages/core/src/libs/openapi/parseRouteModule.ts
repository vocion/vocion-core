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

/** Shared helpers that turn a thrown service error into the standard envelope. */
const ERROR_MAPPER_NAME = /ErrorResponse$/;

/** The shared request-body reader most handlers that take JSON go through. */
const BODY_READER_CALL = 'readJsonBody';

/** The other way a handler reads its body: `req.json()`. */
const REQUEST_IDENTIFIER = /^req(?:uest)?$/;

/** Body readers used across `/api/v1`: `str(body, 'workerId')` and friends. */
const BODY_READER_NAMES = new Set(['str', 'num', 'bool', 'arr', 'obj', 'int']);

/** The longest summary worth showing in a list of endpoints. */
const MAX_SUMMARY_LENGTH = 160;

/** The media type an endpoint answers with unless its own code says otherwise. */
const JSON_MEDIA_TYPE = 'application/json';

/** The constructors a handler uses when it answers with something other than JSON. */
const RESPONSE_CONSTRUCTORS = new Set(['Response', 'NextResponse']);

/** The reads that pull a value out of the query string. */
const SEARCH_PARAM_READERS = new Set(['searchParams.get', 'searchParams.has']);

/** Query parameters that are always whole numbers, whoever documented them. */
const INTEGER_QUERY_PARAMETERS = new Set(['limit', 'offset']);

/** The header a handler reads when it is willing to run with no body at all. */
const CONTENT_LENGTH_HEADER = 'content-length';

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
 * The exported handlers in a route file, keyed by method name.
 *
 * Both shapes Next.js accepts count: `export async function GET(…)` and
 * `export const GET = withSomething(…)`. Reading only the first quietly
 * documented nothing for a route written the second way, and the failure
 * surfaced as a path missing from the spec rather than as anything naming the
 * cause.
 * @param sourceFile - The parsed route file.
 */
function exportedHandlers(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const handlers = new Map<string, ts.Node>();
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) {
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && isHandlerName(statement.name.text)) {
      handlers.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && isHandlerName(declaration.name.text)) {
        // The statement, not the declaration: the doc comment hangs off it.
        handlers.set(declaration.name.text, statement);
      }
    }
  }
  return handlers;
}

/**
 * Whether a top-level statement carries the `export` keyword.
 * @param statement - A statement from the route file.
 */
function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement)
    && (ts.getModifiers(statement) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Whether an exported name is one Next.js treats as an HTTP handler.
 * @param name - The exported name.
 */
function isHandlerName(name: string): boolean {
  return HANDLER_NAMES.includes(name as (typeof HANDLER_NAMES)[number]);
}

/**
 * The handler's doc comment as plain text, with the `@param` tags dropped.
 * @param handler
 */
function docCommentOf(handler: ts.Node): string {
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
    if (line === '' || BULLET_PREFIX.test(line)) {
      // A bullet this cannot read — a name written without backticks, say — is
      // skipped rather than treated as the end of the list. Ending there would
      // silently drop every parameter documented after it.
      continue;
    }
    // A line that is neither blank, a bullet, nor a continuation ends the list.
    inList = false;
  }
  return parameters;
}

/**
 * The query parameters a handler actually reads, whatever its prose says.
 *
 * The doc-comment bullets carry the good description, but nothing forces an
 * author to write one — and a parameter missing from the spec reads to a
 * caller as a parameter that does not exist. So the names come from the code
 * (`searchParams.get('bucket')`) and the descriptions come from the prose
 * wherever there is prose.
 *
 * A name the handler rejects when it is absent — the `if (!bucket)` guard — is
 * published as required, because that is the difference between a request that
 * works and a 400.
 * @param handler - The exported handler.
 */
function queryParametersFromCode(handler: ts.Node): DocumentedParameter[] {
  const required = negatedIdentifiersIn(handler);
  const parameters: DocumentedParameter[] = [];
  const seen = new Set<string>();
  for (const { name, call } of callsWithin(handler)) {
    const reader = name.split('.').slice(-2).join('.');
    if (!SEARCH_PARAM_READERS.has(reader)) {
      continue;
    }
    const parameterName = stringArgument(call, 0);
    if (parameterName === null || seen.has(parameterName)) {
      continue;
    }
    seen.add(parameterName);
    parameters.push({
      name: parameterName,
      in: 'query',
      required: required.has(parameterName) || required.has(bindingNameFor(call)),
      description: '',
      schema: INTEGER_QUERY_PARAMETERS.has(parameterName) ? { type: 'integer' } : { type: 'string' },
    });
  }
  return parameters;
}

/**
 * The variable a query-string read is assigned to, when it is assigned to one.
 *
 * `const bucket = url.searchParams.get('bucket') ?? ''` guards on `bucket`,
 * not on the parameter name, and the two are not always spelled the same.
 * @param call - The `searchParams.get(…)` call.
 */
function bindingNameFor(call: ts.CallExpression): string {
  let node: ts.Node | undefined = call;
  while (node && !ts.isVariableDeclaration(node) && !ts.isSourceFile(node)) {
    node = node.parent;
  }
  return node && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : '';
}

/**
 * Every identifier the handler tests for absence with `!`.
 * @param handler - The exported handler.
 */
function negatedIdentifiersIn(handler: ts.Node): Set<string> {
  const names = new Set<string>();
  for (const node of nodesWithin(handler)) {
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(node.operand)) {
      names.add(node.operand.text);
    }
  }
  return names;
}

/**
 * Merge the parameters the prose describes with the ones the code reads.
 *
 * The prose wins on description and the code wins on existence, so a
 * documented parameter keeps its sentence and an undocumented one still shows
 * up — with the honest note that it has no description yet.
 * @param documented - Parameters read from the doc comment.
 * @param fromCode - Parameters read from the handler body.
 */
function mergeQueryParameters(documented: DocumentedParameter[], fromCode: DocumentedParameter[]): DocumentedParameter[] {
  const merged = [...documented];
  for (const parameter of merged) {
    if (INTEGER_QUERY_PARAMETERS.has(parameter.name)) {
      parameter.schema = { type: 'integer' };
    }
  }
  const byName = new Map(merged.map(parameter => [parameter.name, parameter]));
  for (const parameter of fromCode) {
    const existing = byName.get(parameter.name);
    if (existing) {
      existing.required = existing.required || parameter.required;
      continue;
    }
    merged.push({ ...parameter, description: 'Read from the query string. This one has no description in the handler yet.' });
  }
  return merged;
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
function callsWithin(handler: ts.Node): { name: string; call: ts.CallExpression }[] {
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
function statusFromOptions(call: ts.CallExpression | ts.NewExpression, index: number): number | null {
  const options = call.arguments?.[index];
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
function responsesOf(handler: ts.Node): DocumentedResponse[] {
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

  const responses: DocumentedResponse[] = successResponsesOf(handler, calls).map(success => ({
    status: success.status,
    description: describeSuccessStatus(success.status, success.contentType),
    errorCodes: [],
    contentType: success.contentType,
  }));
  for (const [status, codes] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    responses.push({
      status,
      description: describeStatus(status),
      errorCodes: [...codes].sort(),
      contentType: 'application/json',
    });
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
 * Every success status a handler can return.
 *
 * More than one is normal, and it is the interesting case: `POST
 * /api/v1/automations/:slug/run` answers 202 when the caller asked for the work
 * to carry on in the background and 200 when it waited. A client told only
 * about the 200 meets the async path as a surprise.
 * @param handler
 * @param calls - The call expressions inside the handler.
 */
function successResponsesOf(handler: ts.Node, calls: { name: string; call: ts.CallExpression }[]): { status: number; contentType: string | null }[] {
  const byStatus = new Map<number, string | null>();
  for (const { name, call } of calls) {
    if (name === 'NextResponse.json') {
      // `NextResponse.json(x)` with no options is a plain 200. Reading only the
      // explicit statuses dropped it on a handler that had both.
      const status = statusFromOptions(call, 1) ?? 200;
      if (status < 400) {
        byStatus.set(status, JSON_MEDIA_TYPE);
      }
      continue;
    }
    if (name === 'NextResponse.redirect') {
      // A redirect carries no body at all; Next's own default is 307.
      const status = statusFromOptions(call, 1) ?? numberArgument(call, 1) ?? 307;
      byStatus.set(status, null);
    }
  }
  for (const construction of rawResponsesWithin(handler)) {
    const status = statusFromOptions(construction, 1) ?? 200;
    if (status < 400) {
      byStatus.set(status, contentTypeFromOptions(construction, 1));
    }
  }
  if (byStatus.size === 0) {
    byStatus.set(200, JSON_MEDIA_TYPE);
  }
  return [...byStatus.entries()]
    .map(([status, contentType]) => ({ status, contentType }))
    .sort((left, right) => left.status - right.status);
}

/**
 * The `new Response(…)` / `new NextResponse(…)` constructions in a handler.
 *
 * These are how an endpoint answers with something other than JSON — a stream,
 * a file — and they are constructions rather than calls, so the call list does
 * not see them.
 * @param handler - The exported handler.
 */
function rawResponsesWithin(handler: ts.Node): ts.NewExpression[] {
  const constructions: ts.NewExpression[] = [];
  for (const node of nodesWithin(handler)) {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && RESPONSE_CONSTRUCTORS.has(node.expression.text)) {
      constructions.push(node);
    }
  }
  return constructions;
}

/**
 * The media type an options object declares in its headers, when it says one.
 * @param call - The response call or construction.
 * @param index - Which argument holds the options object.
 */
function contentTypeFromOptions(call: ts.CallExpression | ts.NewExpression, index: number): string {
  const options = call.arguments?.[index];
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return JSON_MEDIA_TYPE;
  }
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'headers' || !ts.isObjectLiteralExpression(property.initializer)) {
      continue;
    }
    for (const header of property.initializer.properties) {
      const name = ts.isPropertyAssignment(header) ? header.name.getText().replace(/['"]/g, '').toLowerCase() : '';
      if (name === 'content-type' && ts.isPropertyAssignment(header) && ts.isStringLiteralLike(header.initializer)) {
        return header.initializer.text.split(';')[0]!.trim();
      }
    }
  }
  return JSON_MEDIA_TYPE;
}

/**
 * Plain English for a success status.
 * @param status - The status code.
 * @param contentType
 */
function describeSuccessStatus(status: number, contentType: string | null): string {
  if (contentType === null) {
    return 'A redirect to the resource; there is no body to read.';
  }
  const wording: Record<number, string> = {
    200: 'Success.',
    201: 'Created.',
    202: 'Accepted — the work carries on in the background.',
    204: 'Success, with no body.',
  };
  const base = wording[status] ?? 'Success.';
  return contentType === JSON_MEDIA_TYPE ? base : `${base} The body is \`${contentType}\`, not JSON.`;
}

/**
 * Whether a called helper maps a thrown service error onto the shared envelope.
 *
 * `isErrorResponse` ends with the same word, and nearly every handler calls it
 * — but it is the guard on a helper's return value and maps nothing. Counting
 * it put a "there may be other statuses" caveat on 54 of the 73 endpoints.
 * @param calledName - The name of a function the handler calls.
 */
function mapsServiceErrors(calledName: string): boolean {
  return ERROR_MAPPER_NAME.test(calledName) && !calledName.startsWith('is');
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
function capabilitiesOf(handler: ts.Node): string[] {
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
 * readers, or `body.workerId` directly — so both are collected, off whichever
 * variables hold the body. The result is the field list, not their types: what
 * a field must contain is in the prose.
 * @param handler - The exported handler declaration.
 * @param bodyNames - The variables this handler bound its body to.
 */
function bodyFieldsOf(handler: ts.Node, bodyNames: Set<string>): string[] {
  const fields = new Set<string>();
  for (const { name, call } of callsWithin(handler)) {
    if (!BODY_READER_NAMES.has(name)) {
      continue;
    }
    const target = call.arguments[0];
    const field = stringArgument(call, 1);
    if (field && target && ts.isIdentifier(target) && bodyNames.has(target.text)) {
      fields.add(field);
    }
  }
  for (const node of nodesWithin(handler)) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && bodyNames.has(node.expression.text)) {
      fields.add(node.name.text);
    }
  }
  return [...fields].sort();
}

/**
 * Whether the handler is happy to run with no request body.
 *
 * Two shapes say so: reading `content-length` to decide whether to parse at
 * all, and defaulting the parsed body with `?? {}`. Publishing such a body as
 * required tells a caller to send `{}` when sending nothing is what the
 * endpoint actually expects.
 * @param handler - The exported handler.
 */
function bodyIsOptional(handler: ts.Node): boolean {
  for (const node of nodesWithin(handler)) {
    if (ts.isStringLiteralLike(node) && node.text.toLowerCase() === CONTENT_LENGTH_HEADER) {
      return true;
    }
    const defaultsToEmptyObject = ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      && ts.isObjectLiteralExpression(node.right)
      && node.right.properties.length === 0;
    if (defaultsToEmptyObject) {
      return true;
    }
  }
  return false;
}

/**
 * The names a handler binds its parsed request body to.
 *
 * A handler reaches the body as `readJsonBody(req)` or as a plain
 * `req.json()`, and then often rebinds it — `const parsed = body as {…}` —
 * before reading a field off it. Following those aliases is what keeps the
 * documented fields honest: looking only for a variable literally named `body`
 * reported `POST /api/v1/workflows/:slug`, which requires one, as taking no
 * body at all.
 *
 * Aliases are resolved by repeating the pass until nothing new turns up, so
 * where a declaration sits in the file does not decide whether it is seen.
 * @param handler - The exported handler declaration.
 */
function bodyIdentifiersOf(handler: ts.Node): Set<string> {
  const names = new Set<string>();
  const bindings = bodyBindingsIn(handler);
  let foundMore = true;
  while (foundMore) {
    foundMore = false;
    for (const binding of bindings) {
      if (names.has(binding.name) || !isRequestBodyExpression(binding.value, names)) {
        continue;
      }
      names.add(binding.name);
      foundMore = true;
    }
  }
  return names;
}

/**
 * Every place a handler binds a name to a value — a declaration with an
 * initializer, or a later assignment.
 *
 * Both matter: a handler that has to catch a parse failure declares the
 * variable first (`let body: unknown;`) and assigns it inside the `try`, so
 * reading declarations alone would miss the body entirely.
 * @param handler - The exported handler declaration.
 */
function bodyBindingsIn(handler: ts.Node): { name: string; value: ts.Expression }[] {
  const bindings: { name: string; value: ts.Expression }[] = [];
  for (const node of nodesWithin(handler)) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.push({ name: node.name.text, value: node.initializer });
      continue;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      bindings.push({ name: node.left.text, value: node.right });
    }
  }
  return bindings;
}

/**
 * Whether an initializer is the request body, or an alias of one already found.
 * @param initializer - The declared variable's initializer.
 * @param known - The names already known to hold the body.
 */
function isRequestBodyExpression(initializer: ts.Expression, known: Set<string>): boolean {
  const expression = unwrapExpression(initializer);
  if (ts.isIdentifier(expression)) {
    return known.has(expression.text);
  }
  if (!ts.isCallExpression(expression)) {
    return false;
  }
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text === BODY_READER_CALL;
  }
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && REQUEST_IDENTIFIER.test(callee.expression.text)
    && callee.name.text === 'json';
}

/**
 * Strip what sits between a declaration and the expression that produced its
 * value: `await`, parentheses, an `as` cast, a `!`, and the `?? {}` a handler
 * adds to default an absent body.
 * @param expression - The expression to unwrap.
 */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (let step = 0; step < 8; step++) {
    if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      current = current.left;
      continue;
    }
    break;
  }
  return current;
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
    const bodyNames = bodyIdentifiersOf(handler);
    const parameters = [
      ...pathParametersFrom(apiPath),
      ...mergeQueryParameters(queryParametersFromDoc(docComment), queryParametersFromCode(handler)),
    ];
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
      requiresBody: bodyNames.size > 0,
      bodyOptional: bodyIsOptional(handler),
      requestBodyFields: bodyFieldsOf(handler, bodyNames),
      capabilities: capabilitiesOf(handler),
      delegatesErrorMapping: [...called].some(mapsServiceErrors),
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
