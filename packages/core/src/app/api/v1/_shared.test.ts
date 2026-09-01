import type { Mode, Principal, Resource } from '@/services/authz';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clerkAuth } from '@/libs/Auth';
import { authenticateBearer } from '@/services/ApiTokenService';
import { WriteApiError } from '@/services/writeApi';
import {
  authApi,
  isErrorResponse,
  jsonError,
  readJsonBody,
  readPagination,
  requireCapability,
  writeApiErrorResponse,
} from './_shared';

vi.mock('@/services/ApiTokenService', () => ({
  authenticateBearer: vi.fn(),
}));
vi.mock('@/libs/Auth', () => ({
  clerkAuth: vi.fn(),
}));

/**
 * The authz check runs for real, so the role mapping is tested against the
 * actual grant table. One test swaps in a thrower to prove a fault that is not
 * a denial still propagates instead of turning into a 403.
 */
let enforceOverride: ((principal: Principal, resource: Resource, mode: Mode) => void) | null = null;
vi.mock('@/services/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/authz')>();
  return {
    ...actual,
    enforce: (principal: Principal, resource: Resource, mode: Mode) => {
      if (enforceOverride) {
        enforceOverride(principal, resource, mode);
        return;
      }
      return actual.enforce(principal, resource, mode);
    },
  };
});

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

/**
 * A signed-in dashboard session, as `clerkAuth` reports one.
 * @param role - Membership role on the active project.
 * @param userId
 */
function sessionOf(role: 'admin' | 'member' | null, userId: string | null = 'u_drew') {
  return {
    userId,
    orgId: userId ? 'org1' : null,
    accountId: 'acct1',
    projectId: 'org1',
    role,
    has: () => true,
  };
}

/**
 * A request carrying whatever credential header the test needs.
 * @param headers
 */
function requestWith(headers: Record<string, string> = {}): Request {
  return new Request('https://vocion.test/api/v1/reviews', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  enforceOverride = null;
});

describe('authApi — bearer token', () => {
  it('resolves a valid token to a token-sourced caller', async () => {
    const principal: Principal = { kind: 'user', id: 'token:t1', role: 'owner', scope: { orgId: 'org1' }, grants: ['*'] };
    mockBearer.mockResolvedValue({ orgId: 'org1', tokenId: 't1', principal } as never);

    const caller = await authApi(requestWith({ authorization: 'Bearer vcn_live_t1_secret' }));

    expect(isErrorResponse(caller)).toBe(false);
    expect(caller).toMatchObject({ orgId: 'org1', actorId: 'token:t1', principal, source: 'token' });
  });

  it('401s on a bad token instead of falling back to the session cookie', async () => {
    mockBearer.mockResolvedValue(null);
    mockSession.mockResolvedValue(sessionOf('admin'));

    const result = await authApi(requestWith({ authorization: 'Bearer nope' }));

    expect(isErrorResponse(result)).toBe(true);

    const res = result as Response;

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(mockSession).not.toHaveBeenCalled();
  });
});

describe('authApi — dashboard session', () => {
  it('maps an admin membership to the owner workspace role', async () => {
    mockSession.mockResolvedValue(sessionOf('admin'));

    const caller = await authApi(requestWith());

    expect(caller).toMatchObject({
      orgId: 'org1',
      actorId: 'u_drew',
      source: 'session',
      principal: { kind: 'user', id: 'u_drew', role: 'owner', scope: { orgId: 'org1' } },
    });
    expect(mockBearer).not.toHaveBeenCalled();
  });

  it('maps a plain member to pm', async () => {
    mockSession.mockResolvedValue(sessionOf('member'));

    const caller = await authApi(requestWith());

    expect(caller).toMatchObject({ principal: { role: 'pm' } });
  });

  it('treats a session with no role as a member', async () => {
    mockSession.mockResolvedValue(sessionOf(null));

    const caller = await authApi(requestWith());

    expect(caller).toMatchObject({ principal: { role: 'pm' } });
  });

  it('authenticates the session when no request is passed at all', async () => {
    mockSession.mockResolvedValue(sessionOf('admin'));

    const caller = await authApi();

    expect(caller).toMatchObject({ source: 'session', actorId: 'u_drew' });
  });

  it('401s when nobody is signed in', async () => {
    mockSession.mockResolvedValue(sessionOf('admin', null));

    const result = await authApi(requestWith());

    expect(isErrorResponse(result)).toBe(true);

    expect((result as Response).status).toBe(401);
  });

  it('401s when the session carries a user but no active project', async () => {
    mockSession.mockResolvedValue({ ...sessionOf('admin'), orgId: null });

    const result = await authApi(requestWith());

    expect((result as Response).status).toBe(401);
  });
});

describe('requireCapability', () => {
  const callerWith = (principal: Principal) => ({ orgId: 'org1', actorId: principal.id, principal, source: 'token' as const });
  const owner: Principal = { kind: 'user', id: 'u1', role: 'owner', scope: { orgId: 'org1' }, grants: ['*'] };
  const specialist: Principal = { kind: 'user', id: 'u2', role: 'specialist', scope: { orgId: 'org1' }, grants: ['draft'] };

  it('returns null when the caller holds the capability', () => {
    expect(requireCapability(callerWith(owner), 'approve')).toBeNull();
  });

  it('returns a 403 body naming the capability when the caller does not', async () => {
    const denied = requireCapability(callerWith(specialist), 'approve');

    expect(denied).not.toBeNull();

    expect((denied as unknown as Response).status).toBe(403);

    const body = await (denied as unknown as Response).json();

    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('approve');
  });

  it('rethrows a fault that is not an authorization denial', () => {
    enforceOverride = () => {
      throw new Error('authz table unreachable');
    };

    expect(() => requireCapability(callerWith(owner), 'approve')).toThrow('authz table unreachable');
  });
});

describe('readPagination', () => {
  const windowFor = (query: string) => readPagination(new URL(`https://vocion.test/api/v1/reviews${query}`));

  it('defaults to 50 rows from the top when nothing is asked for', () => {
    expect(windowFor('')).toEqual({ limit: 50, offset: 0 });
  });

  it('honours a limit and offset inside the allowed range', () => {
    expect(windowFor('?limit=10&offset=25')).toEqual({ limit: 10, offset: 25 });
  });

  it('clamps an oversized limit to 200 rather than erroring', () => {
    expect(windowFor('?limit=9999')).toEqual({ limit: 200, offset: 0 });
  });

  it('falls back to the default on a zero, negative or unparseable limit', () => {
    expect(windowFor('?limit=0').limit).toBe(50);
    expect(windowFor('?limit=-5').limit).toBe(50);
    expect(windowFor('?limit=abc').limit).toBe(50);
  });

  it('floors a negative or unparseable offset at 0', () => {
    expect(windowFor('?offset=-3').offset).toBe(0);
    expect(windowFor('?offset=abc').offset).toBe(0);
  });
});

describe('jsonError', () => {
  it('emits the one error shape, with null details by default', async () => {
    const res = jsonError('NOT_FOUND', 'no such review', 404) as unknown as Response;

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: { code: 'NOT_FOUND', message: 'no such review', details: null } });
  });

  it('passes details through when given', async () => {
    const res = jsonError('CONFLICT', 'near duplicate', 409, { existingId: 7 }) as unknown as Response;
    const body = await res.json();

    expect(body.error.details).toEqual({ existingId: 7 });
  });
});

describe('writeApiErrorResponse', () => {
  it('maps a WriteApiError to its status and code', async () => {
    const res = writeApiErrorResponse(new WriteApiError(400, 'VALIDATION_FAILED', 'id is required')) as unknown as Response;

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'id is required' } });
  });

  it('rethrows anything else so a genuine fault still surfaces', () => {
    expect(() => writeApiErrorResponse(new Error('connection reset'))).toThrow('connection reset');
  });
});

describe('readJsonBody', () => {
  const post = (body: string) => new Request('https://vocion.test/api/v1/reviews/decide', { method: 'POST', body });

  it('returns the parsed object', async () => {
    await expect(readJsonBody(post('{"kind":"action","id":1}'))).resolves.toEqual({ kind: 'action', id: 1 });
  });

  it('400s on a JSON array, which carries none of the fields a handler reads', async () => {
    const result = await readJsonBody(post('[1,2]'));

    expect(isErrorResponse(result)).toBe(true);

    expect((result as Response).status).toBe(400);
  });

  it('400s on a JSON null', async () => {
    const result = await readJsonBody(post('null'));

    expect((result as Response).status).toBe(400);
  });

  it('400s and logs when the body is not JSON at all', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await readJsonBody(post('not json'));

    expect((result as Response).status).toBe(400);
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});

describe('isErrorResponse', () => {
  it('tells a returned error response apart from a value', () => {
    expect(isErrorResponse(jsonError('NOT_FOUND', 'gone', 404))).toBe(true);
    expect(isErrorResponse({ orgId: 'org1' })).toBe(false);
    expect(isErrorResponse(null)).toBe(false);
  });
});
