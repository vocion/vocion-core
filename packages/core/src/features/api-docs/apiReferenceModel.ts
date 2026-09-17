/**
 * Turning the generated OpenAPI document into the rows the reference page
 * shows.
 *
 * The document is nested the way OpenAPI wants — paths, then methods — and the
 * page reads the other way round: one flat, searchable list of endpoints
 * grouped by area. These functions do that translation and nothing else, so
 * the searching and grouping rules can be tested without rendering anything.
 */

/** One path or query parameter, as the generated document writes it. */
export type SpecParameter = {
  name: string;
  in: 'path' | 'query';
  required?: boolean;
  description?: string;
  schema?: { type?: string };
};

/** One response, keyed by status in the document and flattened here. */
export type SpecResponse = {
  status: string;
  description: string;
};

/** One endpoint, as the page lists it. */
export type SpecOperation = {
  method: string;
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  parameters: SpecParameter[];
  /** The body field names the endpoint reads, empty when it takes no body. */
  bodyFields: string[];
  /** True when the endpoint expects a JSON body at all. */
  takesBody: boolean;
  responses: SpecResponse[];
  capabilities: string[];
};

/** The parts of the OpenAPI document this page reads. */
export type ApiReferenceDocument = {
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, unknown>>;
};

/** One group of endpoints on the page. */
export type OperationGroup = {
  tag: string;
  operations: SpecOperation[];
};

/**
 * Read every endpoint out of the document, in the order it lists them.
 * @param document - The generated OpenAPI document.
 */
export function flattenOperations(document: ApiReferenceDocument): SpecOperation[] {
  const operations: SpecOperation[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, raw] of Object.entries(methods)) {
      operations.push(toOperation(path, method, raw as Record<string, unknown>));
    }
  }
  return operations;
}

/**
 * Build one row from the document's operation object.
 * @param path
 * @param method
 * @param raw
 */
function toOperation(path: string, method: string, raw: Record<string, unknown>): SpecOperation {
  const requestBody = raw.requestBody as { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> } | undefined;
  const bodySchema = requestBody?.content?.['application/json']?.schema;
  return {
    method: method.toUpperCase(),
    path,
    operationId: String(raw.operationId ?? `${method}_${path}`),
    tag: String((raw.tags as string[] | undefined)?.[0] ?? 'other'),
    summary: String(raw.summary ?? ''),
    description: String(raw.description ?? ''),
    parameters: (raw.parameters as SpecParameter[] | undefined) ?? [],
    bodyFields: Object.keys(bodySchema?.properties ?? {}),
    takesBody: requestBody !== undefined,
    responses: responsesOf(raw.responses as Record<string, { description?: string }> | undefined),
    capabilities: (raw['x-required-capability'] as string[] | undefined) ?? [],
  };
}

/**
 * Flatten the responses object into a sorted list.
 * @param responses
 */
function responsesOf(responses: Record<string, { description?: string }> | undefined): SpecResponse[] {
  return Object.entries(responses ?? {})
    .map(([status, value]) => ({ status, description: value.description ?? '' }))
    .sort((left, right) => Number(left.status) - Number(right.status));
}

/**
 * The endpoints matching what someone typed into the search box.
 *
 * Every word has to match somewhere, which is what makes `post reviews` find
 * the four ways to act on a review without also finding every GET that
 * mentions one. A word matches the method, the path, the summary or the tag —
 * not the long description, because matching that turns a search for `budget`
 * into half the API.
 * @param operations - Every endpoint in the document.
 * @param query - What the reader typed. Blank returns everything.
 */
export function filterOperations(operations: SpecOperation[], query: string): SpecOperation[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '');
  if (words.length === 0) {
    return operations;
  }
  return operations.filter(operation => words.every(word => matchesWord(operation, word)));
}

/**
 * Whether one search word matches an endpoint.
 * @param operation
 * @param word
 */
function matchesWord(operation: SpecOperation, word: string): boolean {
  const haystack = `${operation.method} ${operation.path} ${operation.summary} ${operation.tag}`.toLowerCase();
  return haystack.includes(word);
}

/**
 * Group endpoints by their area, keeping the document's ordering inside each
 * group and sorting the groups by name.
 * @param operations - The endpoints to group, normally the filtered ones.
 */
export function groupByTag(operations: SpecOperation[]): OperationGroup[] {
  const groups = new Map<string, SpecOperation[]>();
  for (const operation of operations) {
    const existing = groups.get(operation.tag) ?? [];
    existing.push(operation);
    groups.set(operation.tag, existing);
  }
  return [...groups.entries()]
    .map(([tag, tagOperations]) => ({ tag, operations: tagOperations }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}
