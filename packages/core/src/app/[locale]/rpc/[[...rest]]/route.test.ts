/**
 * The RPC endpoint's error logging.
 *
 * Before this, an unexpected throw inside a procedure reached the client as a
 * bare `INTERNAL_SERVER_ERROR` and reached the server log as nothing at all,
 * so the only way to learn what broke was to reproduce the query by hand.
 * These tests pin the two halves of the fix: the real error is written to the
 * log with its procedure path and stack, and what the client receives is still
 * the generic 500 — no database text, no secrets. A refusal the procedure
 * chose, such as a 401, is logged too, but as a warning carrying its status
 * rather than as an error carrying a stack.
 *
 * They also pin the ways the logging must not make things worse: it never
 * replaces the error it is reporting, and it does not wait on the database to
 * name the caller's org — the database is the usual reason a procedure throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
vi.mock('@/routers', async () => {
  const { os, ORPCError } = await import('@orpc/server');
  return {
    router: {
      boom: os.handler(() => {
        throw new Error('column "scope_ref" does not exist');
      }),
      unauthorized: os.handler(() => {
        throw new ORPCError('UNAUTHORIZED', { status: 401 });
      }),
      rejectsWithAnObject: os.handler(() => {
        // eslint-disable-next-line no-throw-literal -- an SDK rejecting with a plain object is the case under test
        throw { pgCode: '42703', detail: 'column does not exist' };
      }),
    },
  };
});

const { logger } = await import('@/libs/Logger');
const { getToken } = await import('next-auth/jwt');
const { POST } = await import('./route');

type LoggedFields = {
  procedure: string;
  orgId: string | null;
  error?: string;
  stack?: string;
  cause?: string;
  status?: number;
  code?: string;
};

/**
 * Call one procedure over the RPC protocol the browser client speaks.
 * @param procedurePath - Path of the procedure to call, e.g. `boom`.
 * @param body - Raw request body, so a malformed one can be tested.
 * @param options - Overrides for the request itself.
 * @param options.pathname - Full pathname, for the URLs a rewrite produces.
 * @param options.headers - Extra request headers, e.g. a forwarded protocol.
 */
async function callProcedure(
  procedurePath: string,
  body = JSON.stringify({ json: {} }),
  options: { pathname?: string; headers?: Record<string, string> } = {},
) {
  const pathname = options.pathname ?? `/rpc/${procedurePath}`;
  const response = await POST(new Request(`http://localhost:3000${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body,
  }));

  return { response, body: await response.text() };
}

/**
 * The fields of the most recent call at one log level.
 *
 * logtape's methods are overloaded — one of their shapes takes a callback — so
 * the mock's call tuple is not typed as the message-plus-fields shape these
 * tests assert on. Reading it in one place keeps the cast out of the assertions.
 * @param level - Which logger method to read.
 */
function lastLogged(level: 'error' | 'warn'): { message: string; fields: LoggedFields } {
  const calls = vi.mocked(logger[level]).mock.calls as unknown as [string, LoggedFields][];
  const lastCall = calls.at(-1);
  if (!lastCall) {
    throw new Error(`logger.${level} was not called`);
  }
  return { message: lastCall[0], fields: lastCall[1] };
}

describe('rpc error logging', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
    vi.mocked(getToken).mockResolvedValue({ projectId: 'org_1' } as any);
    vi.mocked(logger.error).mockReset();
    vi.mocked(logger.warn).mockReset();
  });

  it('logs an unexpected throw with its procedure path, message and stack', async () => {
    await callProcedure('boom');

    expect(logger.error).toHaveBeenCalledTimes(1);

    const { message, fields } = lastLogged('error');

    expect(message).toContain('boom');
    expect(fields).toMatchObject({
      procedure: 'boom',
      orgId: 'org_1',
      error: 'column "scope_ref" does not exist',
    });
    expect(fields.stack).toContain('Error: column "scope_ref" does not exist');
  });

  it('still answers an unexpected throw with a generic INTERNAL_SERVER_ERROR', async () => {
    const { response, body } = await callProcedure('boom');

    expect(response.status).toBe(500);
    expect(JSON.parse(body).json).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', status: 500 });
    expect(body).not.toContain('scope_ref');
  });

  it('logs a deliberate 401 as a warning, not as an error', async () => {
    const { response } = await callProcedure('unauthorized');

    expect(response.status).toBe(401);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const { message, fields } = lastLogged('warn');

    expect(message).toContain('unauthorized');
    expect(fields).toMatchObject({
      procedure: 'unauthorized',
      orgId: 'org_1',
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(fields.stack).toBeUndefined();
  });

  it('names a thrown non-Error instead of recording [object Object]', async () => {
    await callProcedure('rejectsWithAnObject');

    const { fields } = lastLogged('error');

    expect(fields.error).toContain('42703');
    expect(fields.error).not.toContain('[object Object]');
  });

  it('logs a request that fails before it reaches a procedure', async () => {
    const { response } = await callProcedure('boom', 'this is not json');

    expect(response.status).toBe(400);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(lastLogged('error').fields.procedure).toBe('boom');
  });

  it('does not read the org from the database, only from the session cookie', async () => {
    await callProcedure('boom');

    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('logs the error even when the session cookie cannot be read', async () => {
    vi.mocked(getToken).mockRejectedValue(new Error('bad AUTH_SECRET'));

    await callProcedure('boom');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(lastLogged('error').fields.orgId).toBeNull();
  });

  it('404s a path the handler is not mounted under, without logging an error', async () => {
    // Worth pinning, because it settles what `readProcedurePath` has to cope
    // with. `localePrefix` is `'as-needed'`, so a rewrite to `/en/rpc/boom`
    // looked possible — but oRPC matches on the `/rpc` prefix, so such a
    // request never reaches a procedure at all. A locale can therefore never
    // turn up in a logged procedure name.
    const { response } = await callProcedure('boom', undefined, { pathname: '/en/rpc/boom' });

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('looks for the secure session cookie when the proxy forwarded HTTPS', async () => {
    // TLS terminates at the reverse proxy, so the request itself is plain
    // HTTP while the browser's cookie is `__Secure-` prefixed. Asking for the
    // wrong name finds nothing and reports no error, which is how every
    // production log line came to say `orgId: null`.
    await callProcedure('boom', undefined, { headers: { 'x-forwarded-proto': 'https' } });

    expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
    expect(lastLogged('error').fields.orgId).toBe('org_1');
  });

  it('takes the browser-facing hop from a chain of forwarded protocols', async () => {
    await callProcedure('boom', undefined, { headers: { 'x-forwarded-proto': 'https, http' } });

    expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
  });

  it('looks for the plain session cookie when nothing forwarded HTTPS', async () => {
    await callProcedure('boom');

    expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: false }));
  });

  it('keeps the original error when the logger itself throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {
      throw new Error('log sink is misconfigured');
    });

    const { response, body } = await callProcedure('boom');

    expect(response.status).toBe(500);
    expect(JSON.parse(body).json).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
