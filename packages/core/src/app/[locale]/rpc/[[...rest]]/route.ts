/**
 * The endpoint every oRPC procedure is served from.
 *
 * The handler carries an `onError` interceptor because oRPC otherwise turns an
 * unexpected throw inside a procedure into a bare `INTERNAL_SERVER_ERROR` with
 * nothing written server-side: the cause never reaches a log, so a failing
 * procedure can only be diagnosed by reproducing its query by hand. The
 * interceptor records the real error before oRPC flattens it. What the client
 * receives is unchanged and still generic — no database text, no secrets.
 *
 * Two levels: an unexpected throw is an `error` with its stack, and a refusal
 * the procedure chose (401, 403, 404, 400) is a `warning` with its status and
 * code. Both are logged, so a caller bouncing off an expired session is
 * visible without a stack next to it.
 *
 * The interceptor sits at the request level rather than the procedure-client
 * level so that it also covers the steps around the procedure — decoding the
 * request body, matching the route, encoding the response. A procedure that
 * returns something the RPC serializer cannot represent fails after the
 * procedure itself has returned, and that failure is just as invisible.
 */

import { inspect } from 'node:util';
import { onError, ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { getToken } from 'next-auth/jwt';
import { logger } from '@/libs/Logger';
import { router } from '@/routers';

/**
 * What the handler is given per request, purely so the error log can name the
 * org the failed call belonged to. Procedures do their own `guardAuth()` and
 * ignore this.
 */
type RpcRequestContext = {
  request: Request;
};

/**
 * The slice of oRPC's request-level interceptor options this file reads.
 */
type RpcErrorInterceptorOptions = {
  request: { url: URL };
  prefix?: string;
  context: RpcRequestContext;
};

/**
 * Whether the caller reached the app over HTTPS.
 *
 * This decides which cookie `getToken` looks for, and getting it wrong is
 * silent: Auth.js writes `__Secure-authjs.session-token` on an HTTPS site and
 * `authjs.session-token` otherwise, and `getToken` defaults to the second
 * name. Production terminates TLS at the reverse proxy and forwards plain HTTP
 * to the app, so the request's own protocol reads `http:` and only
 * `x-forwarded-proto` knows what the browser actually spoke. Without this,
 * every production log line reported `orgId: null` — no cookie found, no error
 * either.
 * @param request - The request to judge.
 */
function isRequestOverHttps(request: Request): boolean {
  const forwardedProtocol = request.headers.get('x-forwarded-proto');
  if (forwardedProtocol) {
    // A chain of proxies appends to this header; the browser-facing hop is first.
    const [clientFacingProtocol] = forwardedProtocol.split(',');
    return clientFacingProtocol?.trim() === 'https';
  }
  return new URL(request.url).protocol === 'https:';
}

/**
 * Read the caller's org from the session cookie, or `null` when there isn't one.
 *
 * Deliberately the JWT and not `auth()`: the session callback re-resolves
 * tenancy against the database on every read, and the most common reason a
 * procedure throws is the database being unreachable. Logging must not queue
 * behind the thing that just failed. Decoding the cookie is local work.
 * @param request - The request whose session cookie to read.
 */
async function readOrgIdForLogging(request: Request): Promise<string | null> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: isRequestOverHttps(request),
    });
    return typeof token?.projectId === 'string' ? token.projectId : null;
  } catch (sessionError) {
    logger.warn('rpc error logging could not read the session cookie', {
      error: sessionError instanceof Error ? sessionError.message : String(sessionError),
    });
    return null;
  }
}

/**
 * Name the procedure a failed request was aimed at, e.g. `conversations/list`.
 *
 * Taken from the URL rather than from a match, because a request that fails
 * while its body is being decoded never reaches one.
 * @param url - The request URL.
 * @param prefix - The prefix the handler is mounted under, if any.
 */
function readProcedurePath(url: URL, prefix: string | undefined): string {
  const pathname = prefix ? url.pathname.replace(prefix, '') : url.pathname;
  return pathname.replace(/^\/|\/$/g, '') || '(unmatched)';
}

/**
 * Describe a thrown value for the log.
 *
 * Not everything thrown is an `Error` — an SDK can reject with a plain object,
 * and `String(value)` would record that as `[object Object]`, which is barely
 * better than the silence this whole interceptor exists to remove.
 * @param thrown - Whatever was thrown.
 */
function describeThrownValue(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  if (typeof thrown === 'string') {
    return thrown;
  }
  return inspect(thrown, { depth: 3, breakLength: Number.POSITIVE_INFINITY });
}

/**
 * Decide whether a thrown value is an error the procedure raised on purpose.
 *
 * `ApiError.unauthorized()` and friends are ordinary control flow — a signed
 * out caller, a missing row — so they are recorded, but at warning level and
 * without a stack: an expired session is worth seeing in the log without it
 * competing with the failures that need someone to look at code.
 * @param error - Whatever the procedure threw.
 */
function isDeliberateClientError(error: unknown): error is ORPCError<string, unknown> {
  return error instanceof ORPCError && error.status < 500;
}

/**
 * Write one line for an error that came out of a request.
 * @param error - Whatever was thrown.
 * @param options - oRPC's interceptor options for the request.
 */
async function writeErrorLogLine(error: unknown, options: RpcErrorInterceptorOptions): Promise<void> {
  const procedurePath = readProcedurePath(options.request.url, options.prefix);
  const orgId = await readOrgIdForLogging(options.context.request);

  // A refusal the procedure chose — 401, 403, 404, 400. The status and code
  // are the whole story; the stack would only point at the guard that raised
  // it, which is the same guard every time.
  if (isDeliberateClientError(error)) {
    logger.warn(`rpc procedure ${procedurePath} refused the call`, {
      procedure: procedurePath,
      orgId,
      status: error.status,
      code: error.code,
    });
    return;
  }

  logger.error(`rpc procedure ${procedurePath} failed`, {
    procedure: procedurePath,
    orgId,
    error: describeThrownValue(error),
    stack: error instanceof Error ? error.stack : undefined,
    cause: error instanceof Error && error.cause !== undefined ? describeThrownValue(error.cause) : undefined,
  });
}

/**
 * Log a failed request, and never let the logging itself become the failure.
 *
 * oRPC awaits this callback inside its own catch and rethrows afterwards, so a
 * throw in here would replace the error being reported with the logging error
 * and leave the real one unrecorded — the silent 500 this file exists to
 * prevent. A broken sink falls back to the console.
 * @param error - Whatever was thrown.
 * @param options - oRPC's interceptor options for the request.
 */
async function logProcedureError(error: unknown, options: RpcErrorInterceptorOptions): Promise<void> {
  try {
    await writeErrorLogLine(error, options);
  } catch (loggingError) {
    console.error('rpc error logging failed', loggingError);
    console.error('the error it was reporting', error);
  }
}

const handler = new RPCHandler<RpcRequestContext>(router, {
  interceptors: [onError(logProcedureError)],
});

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: { request },
  });

  return response ?? new Response('Not found', { status: 404 });
}

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
