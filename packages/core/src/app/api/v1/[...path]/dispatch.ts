import type { NextRequest } from 'next/server';

/**
 * Serves every `/api/v1` request from one route entry, the way Next served it
 * from 114 (#1598).
 *
 * Why one entry: Turbopack plans the chunks of each route entry on its own, and
 * every v1 handler reaches about 1,300 modules through `_routes/_shared.ts`.
 * With 114 entries the image build peaked near 9 GB; the same handlers behind
 * one entry peaked at 6.9 GB (README.md in the parent folder has the runs).
 * The handlers did not change: they still live in `route.ts` files, under the
 * private folder `../_routes/`, which Next does not route.
 *
 * What this copies from Next 16.4.6 so a caller sees no difference:
 * - Matching: a static folder name wins over a `[param]` folder at the same
 *   depth, so `reviews/decide` is never read as `reviews/[kind]`.
 * - `context.params` is a Promise of `{ name: value }`, built from the same
 *   decoded path segments Next hands the catch-all.
 * - A method the handler does not export answers 405 with an empty body.
 * - HEAD falls back to the handler's GET, and OPTIONS (unless the handler
 *   exports one) answers 204 with an `Allow` header, as Next's
 *   `autoImplementMethods` does
 *   (next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js).
 * - Anything a handler throws, `notFound()` and `redirect()` included, is not
 *   caught here, so Next turns it into a response exactly as before.
 *
 * One difference: a path no handler matches answers 404 with an empty body,
 * where Next used to render the app's not-found page.
 */

/** The methods a Next route handler can export, in Next's own order. */
export const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** One handler module and the URL segments its folder gives it. */
export type V1Route = {
  /** Folder names below `_routes/`, e.g. `['objects', '[id]', 'analyze']`. */
  segments: readonly string[];
  /** The module's exports: `GET`, `POST` and the rest, as Next would read them. */
  handlers: Readonly<Record<string, unknown>>;
};

/** The second argument Next passes a route handler. */
type RouteContext = { params: Promise<Record<string, string>> };

type RouteHandler = (request: NextRequest, context: RouteContext) => Response | Promise<Response>;

/** The route a path resolves to, with the values of its `[param]` segments. */
export type V1Match = { route: V1Route; params: Record<string, string> };

/**
 * Whether a folder name is a `[param]` segment.
 * @param segment - One folder name.
 */
export function isParamSegment(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

/**
 * How specific a route is, as a string that sorts the way Next tries routes:
 * one character per segment, `0` for a static name and `1` for a `[param]`, so
 * among routes matching the same path the smallest key is the one Next picks.
 * @param route - The route to rank.
 */
function precedenceKey(route: V1Route): string {
  return route.segments.map(segment => (isParamSegment(segment) ? '1' : '0')).join('');
}

/**
 * The params a route reads from a path, or null when the route does not match it.
 * @param route - The route to try.
 * @param pathSegments - The request path below `/api/v1`, one decoded segment each.
 */
export function paramsIfMatches(route: V1Route, pathSegments: readonly string[]): Record<string, string> | null {
  if (route.segments.length !== pathSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of route.segments.entries()) {
    const value = pathSegments[index] as string;
    if (isParamSegment(segment)) {
      params[segment.slice(1, -1)] = value;
    } else if (segment !== value) {
      return null;
    }
  }
  return params;
}

/**
 * The route Next would have picked for a path. Routes of the same length that
 * both match differ first where one has a static name and the other a
 * `[param]`, and the static one wins; the route-table generator refuses two
 * different param names in the same place, so the winner is never a tie.
 * @param routes - Every v1 route.
 * @param pathSegments - The request path below `/api/v1`, one decoded segment each.
 */
export function matchV1Route(routes: readonly V1Route[], pathSegments: readonly string[]): V1Match | null {
  let best: V1Match | null = null;
  let bestKey = '';
  for (const route of routes) {
    const params = paramsIfMatches(route, pathSegments);
    if (params === null) {
      continue;
    }
    const key = precedenceKey(route);
    if (best === null || key < bestKey) {
      best = { route, params };
      bestKey = key;
    }
  }
  return best;
}

/**
 * The function that answers a method, the way Next picks it: the handler's own
 * export, else for HEAD its GET, else nothing.
 * @param handlers - The handler module's exports.
 * @param method - The request method.
 */
export function implementedHandler(handlers: V1Route['handlers'], method: HttpMethod): RouteHandler | null {
  const own = handlers[method];
  if (typeof own === 'function') {
    return own as RouteHandler;
  }
  if (method === 'HEAD' && typeof handlers.GET === 'function') {
    return handlers.GET as RouteHandler;
  }
  return null;
}

/**
 * The `Allow` header Next sends for an automatic OPTIONS answer: OPTIONS, the
 * methods the module exports, and HEAD when it exports GET, sorted and joined.
 * @param handlers - The handler module's exports.
 */
export function automaticAllowHeader(handlers: V1Route['handlers']): string {
  const implemented: string[] = HTTP_METHODS.filter(method => typeof handlers[method] === 'function');
  const allow = ['OPTIONS', ...implemented];
  if (!implemented.includes('HEAD') && implemented.includes('GET')) {
    allow.push('HEAD');
  }
  return allow.sort().join(', ');
}

/**
 * Answer one `/api/v1` request with the handler Next would have run.
 * @param routes - Every v1 route (`V1_ROUTES` from the generated table).
 * @param method - The method of the catch-all export that received the request.
 * @param request - The request, passed to the handler untouched.
 * @param pathSegments - The catch-all's `path` param: the path below `/api/v1`.
 */
export async function dispatchV1Request(
  routes: readonly V1Route[],
  method: HttpMethod,
  request: NextRequest,
  pathSegments: readonly string[],
): Promise<Response> {
  const match = matchV1Route(routes, pathSegments);
  if (match === null) {
    return new Response(null, { status: 404 });
  }
  const handler = implementedHandler(match.route.handlers, method);
  if (handler !== null) {
    return handler(request, { params: Promise.resolve(match.params) });
  }
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: automaticAllowHeader(match.route.handlers) } });
  }
  return new Response(null, { status: 405 });
}
