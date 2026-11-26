import type { V1Route } from './dispatch';
import { autoImplementMethods } from 'next/dist/server/route-modules/app-route/helpers/auto-implement-methods';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { dispatchV1Request, HTTP_METHODS, matchV1Route } from './dispatch';

/**
 * The dispatcher must answer every request the way Next answered it when each
 * v1 handler was its own route. Where Next's behaviour lives in code we can
 * import (`autoImplementMethods`: 405s, HEAD and OPTIONS), these tests compare
 * against Next itself rather than against a copy of what we think it does.
 */

type Context = { params: Promise<Record<string, string>> };

async function answerGet(): Promise<Response> {
  return new Response('GET handler');
}

async function answerHead(): Promise<Response> {
  return new Response('HEAD handler');
}

async function answerOptions(): Promise<Response> {
  return new Response('OPTIONS handler', { status: 200 });
}

async function answerPost(): Promise<Response> {
  return new Response('POST handler', { status: 201 });
}

async function answerPut(): Promise<Response> {
  return new Response('PUT handler');
}

async function answerDelete(): Promise<Response> {
  return new Response(null, { status: 204 });
}

async function answerPatch(): Promise<Response> {
  return new Response('PATCH handler');
}

async function echoParams(_request: NextRequest, context: Context): Promise<Response> {
  return Response.json(await context.params);
}

async function failing(): Promise<Response> {
  throw new Error('handler failed');
}

/**
 * A request for a v1 path.
 * @param method - The HTTP method.
 * @param path - The path below `/api/v1`.
 */
function requestFor(method: string, path = 'things'): NextRequest {
  return new NextRequest(`http://localhost/api/v1/${path}`, { method });
}

/**
 * The parts of a response a caller can see.
 * @param response - The response to read.
 */
async function visible(response: Response): Promise<{ status: number; allow: string | null; body: string }> {
  return { status: response.status, allow: response.headers.get('allow'), body: await response.text() };
}

/** Handler modules with the export shapes the v1 handlers use, and the ones Next treats specially. */
const MODULE_SHAPES: Record<string, Record<string, unknown>> = {
  'GET only': { GET: answerGet },
  'POST only': { POST: answerPost },
  'GET and POST': { GET: answerGet, POST: answerPost },
  'GET and its own HEAD': { GET: answerGet, HEAD: answerHead },
  'its own OPTIONS': { GET: answerGet, OPTIONS: answerOptions },
  'writes only': { PUT: answerPut, DELETE: answerDelete, PATCH: answerPatch },
};

describe('a matched v1 path answers every method exactly as Next answered it', () => {
  for (const [shape, handlers] of Object.entries(MODULE_SHAPES)) {
    for (const method of HTTP_METHODS) {
      it(`${method} on a handler with ${shape}`, async () => {
        const routes: V1Route[] = [{ segments: ['things'], handlers }];
        const nextAnswer = await autoImplementMethods(handlers as never)[method](requestFor(method), { params: Promise.resolve({}) } as never) as Response;
        const ourAnswer = await dispatchV1Request(routes, method, requestFor(method), ['things']);

        expect(await visible(ourAnswer)).toEqual(await visible(nextAnswer));
      });
    }
  }
});

describe('matching a path to its handler', () => {
  const decide: V1Route = { segments: ['reviews', 'decide'], handlers: { POST: answerPost } };
  const byKind: V1Route = { segments: ['reviews', '[kind]'], handlers: { GET: echoParams } };
  const item: V1Route = { segments: ['reviews', '[kind]', '[id]'], handlers: { GET: echoParams } };
  const routes = [byKind, decide, item];

  it('picks a static folder over a [param] folder at the same depth, whatever the table order', () => {
    expect(matchV1Route(routes, ['reviews', 'decide'])?.route).toBe(decide);
    expect(matchV1Route([decide, byKind, item], ['reviews', 'decide'])?.route).toBe(decide);
  });

  it('passes [param] values to the handler as a Promise of { name: value }', async () => {
    const response = await dispatchV1Request(routes, 'GET', requestFor('GET', 'reviews/proposal/42'), ['reviews', 'proposal', '42']);

    expect(await response.json()).toEqual({ kind: 'proposal', id: '42' });
  });

  it('does not let a [param] swallow a deeper or shallower path', () => {
    expect(matchV1Route(routes, ['reviews'])).toBeNull();
    expect(matchV1Route(routes, ['reviews', 'a', 'b', 'c'])).toBeNull();
  });

  it('answers 404 with an empty body when no handler matches', async () => {
    const response = await dispatchV1Request(routes, 'GET', requestFor('GET', 'nowhere'), ['nowhere']);

    expect(await visible(response)).toEqual({ status: 404, allow: null, body: '' });
  });

  it('lets a handler error reach Next untouched, so Next answers it as before', async () => {
    const failingRoutes = [{ segments: ['things'], handlers: { GET: failing } }];

    await expect(dispatchV1Request(failingRoutes, 'GET', requestFor('GET'), ['things'])).rejects.toThrow('handler failed');
  });
});
