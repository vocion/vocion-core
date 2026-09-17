import { describe, expect, it } from 'vitest';
import { operationIdFor, parseRouteModule, routeFileToApiPath } from './parseRouteModule';

/**
 * The generator's whole promise is that the published spec matches the code,
 * so what these pin is the reading: an endpoint that exists is documented, one
 * that does not is not, and everything in between — the parameters, the
 * capability, the statuses — is what the handler actually does rather than
 * what someone once wrote down.
 */

const REVIEWS_ROUTE = `
import { NextResponse } from 'next/server';
import { authApi, isErrorResponse, jsonError, readPagination, requireCapability } from '../_shared';

/**
 * GET /api/v1/reviews
 *
 * The pending-review queue for the caller's org. More prose here that should
 * not reach the summary.
 *
 * Query parameters:
 * - \`kind\` — \`workflow\` | \`mission\` | \`action\`, to see one plane only.
 * - \`limit\`, \`offset\` — the page window.
 *   The response carries the real total.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { limit, offset } = readPagination(new URL(req.url));
  if (limit < 0) {
    return jsonError('VALIDATION_FAILED', 'bad window', 400);
  }
  return NextResponse.json({ items: [], limit, offset });
}

/**
 * POST /api/v1/reviews
 *
 * Open a review.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'approve');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  const kind = str(body, 'kind');
  if (!kind || !body.itemId) {
    return jsonError('VALIDATION_FAILED', 'kind is required', 400);
  }
  if (kind === 'taken') {
    return jsonError('CONFLICT', 'already open', 409);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** Not exported, so not an endpoint. */
async function DELETE(req: Request) {
  return jsonError('GONE', 'nope', 410);
}
`;

describe('routeFileToApiPath', () => {
  it('turns a route file into its path template, dynamic segments and all', () => {
    expect(routeFileToApiPath('worker-runs/[id]/claim/route.ts')).toBe('/api/v1/worker-runs/{id}/claim');
    expect(routeFileToApiPath('reviews/route.ts')).toBe('/api/v1/reviews');
    expect(routeFileToApiPath('route.ts')).toBe('/api/v1');
  });
});

describe('operationIdFor', () => {
  it('gives every method and path pair its own id', () => {
    expect(operationIdFor('post', '/api/v1/worker-runs/{id}/claim')).toBe('post_worker_runs_id_claim');
    expect(operationIdFor('get', '/api/v1/reviews')).not.toBe(operationIdFor('post', '/api/v1/reviews'));
  });
});

describe('parseRouteModule', () => {
  const operations = parseRouteModule(REVIEWS_ROUTE, '/api/v1/reviews');
  const get = operations.find(operation => operation.method === 'get');
  const post = operations.find(operation => operation.method === 'post');

  it('documents the exported handlers and nothing else', () => {
    expect(operations.map(operation => operation.method)).toEqual(['get', 'post']);
  });

  it('takes the summary from the prose, not the signature line the spec already knows', () => {
    expect(get?.summary).toBe('The pending-review queue for the caller\'s org.');
    expect(get?.description.startsWith('The pending-review queue')).toBe(true);
    expect(get?.description).not.toContain('GET /api/v1/reviews');
  });

  it('reads the query parameters out of the doc comment, including a bullet that names two', () => {
    const names = get?.parameters.filter(parameter => parameter.in === 'query').map(parameter => parameter.name);

    expect(names).toEqual(['kind', 'limit', 'offset']);
  });

  it('keeps a continuation line with the parameters its bullet named', () => {
    const limit = get?.parameters.find(parameter => parameter.name === 'limit');

    expect(limit?.description).toBe('the page window. The response carries the real total.');
  });

  it('does not add its own pagination parameters over the documented ones', () => {
    const limits = get?.parameters.filter(parameter => parameter.name === 'limit');

    expect(limits).toHaveLength(1);
  });

  it('attributes statuses to the handler that can send them, not to the file', () => {
    expect(get?.responses.map(response => response.status)).toEqual([200, 400, 401]);
    expect(post?.responses.map(response => response.status)).toEqual([201, 400, 401, 403, 409]);
  });

  it('names the error codes a status can carry', () => {
    const conflict = post?.responses.find(response => response.status === 409);

    expect(conflict?.errorCodes).toEqual(['CONFLICT']);
  });

  it('records the capability a handler enforces', () => {
    expect(post?.capabilities).toEqual(['approve']);
    expect(get?.capabilities).toEqual([]);
  });

  it('lists the body fields a handler reads, however it reads them', () => {
    expect(post?.requiresBody).toBe(true);
    expect(post?.requestBodyFields).toEqual(['itemId', 'kind']);
    expect(get?.requiresBody).toBe(false);
  });

  it('types a numeric id path parameter as an integer', () => {
    const [claim] = parseRouteModule(
      `export async function POST(req: Request) { return null; }`,
      '/api/v1/worker-runs/{id}/claim',
    );

    expect(claim?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, description: 'The id from the URL.', schema: { type: 'integer' } },
    ]);
  });

  it('falls back to the method and path when a handler has no doc comment', () => {
    const [bare] = parseRouteModule(`export async function GET() { return null; }`, '/api/v1/budgets');

    expect(bare?.summary).toBe('GET /api/v1/budgets');
  });
});

/**
 * The shapes the generator used to get wrong, kept as their own fixtures: a
 * handler with two success paths, and one that reads its body without the
 * shared helper and then renames it. Both are real patterns in `/api/v1`, and
 * both published a document that quietly disagreed with the code.
 */
const AWKWARD_ROUTE = `
import { NextResponse } from 'next/server';
import { authApi, isErrorResponse, jsonError } from '../_shared';
import { workerRunErrorResponse } from '../_lib';

/**
 * POST /api/v1/awkward
 *
 * Runs the work, or hands it to the background when asked.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }
  const parsed = body as { input?: unknown; background?: unknown };
  if (parsed.background === true) {
    return NextResponse.json({ queued: true }, { status: 202 });
  }
  return NextResponse.json({ input: parsed.input }, { status: 200 });
}

/**
 * GET /api/v1/awkward
 *
 * Reads it back.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  try {
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
`;

describe('parseRouteModule, on the shapes that used to be read wrong', () => {
  const operations = parseRouteModule(AWKWARD_ROUTE, '/api/v1/awkward');
  const post = operations.find(operation => operation.method === 'post');
  const get = operations.find(operation => operation.method === 'get');

  it('documents every success status, not just the first one found', () => {
    const successes = post?.responses.filter(response => response.status < 400).map(response => response.status);

    expect(successes).toEqual([200, 202]);
  });

  it('finds the body when the handler reads it with req.json() and renames it', () => {
    expect(post?.requiresBody).toBe(true);
    expect(post?.requestBodyFields).toEqual(['background', 'input']);
  });

  it('does not call `isErrorResponse` an error mapper — nearly every handler guards with it', () => {
    expect(post?.delegatesErrorMapping).toBe(false);
    expect(get?.delegatesErrorMapping).toBe(true);
  });
});

describe('queryParametersFromDoc, on a bullet it cannot read', () => {
  it('skips the malformed bullet and keeps reading the ones after it', () => {
    const [operation] = parseRouteModule(
      `
/**
 * GET /api/v1/things
 *
 * Things.
 *
 * Query parameters:
 * - kind — written without backticks, so the name cannot be trusted.
 * - \`limit\` — how many to return.
 * @param req - Request.
 */
export async function GET(req: Request) {
  return null;
}
`,
      '/api/v1/things',
    );

    expect(operation?.parameters.map(parameter => parameter.name)).toEqual(['limit']);
  });
});
