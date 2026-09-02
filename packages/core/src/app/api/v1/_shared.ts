import type { NextResponse as NextResponseType } from 'next/server';
import type { WorkspaceRole } from '@/services/authz';
import type { ApiCaller } from '@/services/writeApi';
import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { authenticateBearer } from '@/services/ApiTokenService';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { WriteApiError } from '@/services/writeApi';

/**
 * Shared plumbing for the `/api/v1` route handlers: authentication, error
 * bodies, and pagination parsing.
 *
 * Every endpoint accepts **either** credential:
 *
 * - `Authorization: Bearer vcn_live_…` — a tenant API token. This is how an
 *   external app (the Veerio admin panel, for one) drives Vocion.
 * - A signed-in dashboard session cookie, for calls made from the browser.
 *
 * Both resolve to the same {@link ApiCaller}, so a handler never has to care
 * which one it got, and the authorization check below runs identically for both.
 */

/**
 * A dashboard membership role is coarser than a workspace role. Admins get the
 * unrestricted `owner` bundle; ordinary members get `pm`, which is also
 * unrestricted — that matches how the dashboard behaved before these endpoints
 * were authorized at all, so no browser flow loses access.
 */
const MEMBERSHIP_ROLE_TO_WORKSPACE_ROLE: Record<'admin' | 'member', WorkspaceRole> = {
  admin: 'owner',
  member: 'pm',
};

/**
 * Authenticate an API request as a tenant token or a dashboard session.
 *
 * An `Authorization` header, when present, is the credential — a bad token is a
 * 401 and never silently falls back to whatever cookie the request happened to
 * carry. With no header at all, the signed-in session is used instead.
 * @param req - The incoming request. Omit it to force session-only authentication.
 */
export async function authApi(req?: Request): Promise<ApiCaller | NextResponseType> {
  const authHeader = req?.headers.get('authorization');
  if (authHeader) {
    const identity = await authenticateBearer(authHeader);
    if (!identity) {
      return jsonError('UNAUTHORIZED', 'Missing or invalid bearer token', 401);
    }
    return {
      orgId: identity.orgId,
      actorId: `token:${identity.tokenId}`,
      principal: identity.principal,
      source: 'token',
    };
  }

  const { userId, orgId, role } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }
  return {
    orgId,
    actorId: userId,
    principal: {
      kind: 'user',
      id: userId,
      role: MEMBERSHIP_ROLE_TO_WORKSPACE_ROLE[role ?? 'member'],
      scope: { orgId },
    },
    source: 'session',
  };
}

/**
 * Check that the caller holds a capability, returning a 403 body when it does
 * not and `null` when it does. Handlers guard with:
 *
 * ```ts
 * const denied = requireCapability(caller, 'approve');
 * if (denied) { return denied; }
 * ```
 * @param caller
 * @param action - The capability name, e.g. `approve` or `draft`.
 */
export function requireCapability(caller: ApiCaller, action: string): NextResponseType | null {
  try {
    enforce(caller.principal, { kind: 'action', action, scope: { orgId: caller.orgId } }, 'mutate');
    return null;
  } catch (e) {
    if (e instanceof AuthzDeniedError) {
      return jsonError('FORBIDDEN', `Not allowed to ${action}: ${e.decision.reason}`, 403);
    }
    throw e;
  }
}

/**
 * Read a numeric `:id` path segment, or return the 400 body to send back.
 *
 * Strict on purpose: `Number.parseInt` reads `"12abc"` as `12`, which would act
 * on a record the client never named. Only digits are accepted.
 * @param raw - The raw path segment.
 * @param what - What the id names, for the error message.
 */
export function readIdParam(raw: string, what: string): number | NextResponseType {
  if (!/^\d+$/.test(raw)) {
    return jsonError('VALIDATION_FAILED', `${what} id must be a positive integer`, 400);
  }
  return Number.parseInt(raw, 10);
}

/** Page window for a list endpoint, clamped so one request cannot scan a table. */
export type PageWindow = { limit: number; offset: number };

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Read `limit` and `offset` from a request URL. Both are clamped: a missing,
 * unparseable or out-of-range value falls back to the default rather than
 * erroring, because a paging bug in a client should not break the page.
 * @param url
 */
export function readPagination(url: URL): PageWindow {
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const rawOffset = Number.parseInt(url.searchParams.get('offset') ?? '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

/**
 * The one error shape every `/api/v1` endpoint emits.
 * @param code
 * @param message
 * @param status
 * @param details
 */
export function jsonError(code: string, message: string, status: number, details?: Record<string, unknown>): NextResponseType {
  return NextResponse.json(
    { error: { code, message, details: details ?? null } },
    { status },
  );
}

/**
 * Map a thrown {@link WriteApiError} to its JSON body; rethrow anything else so
 * a genuine fault still surfaces as a 500 with a stack trace.
 * @param error
 */
export function writeApiErrorResponse(error: unknown): NextResponseType {
  if (error instanceof WriteApiError) {
    return jsonError(error.code, error.message, error.status);
  }
  throw error;
}

/**
 * Parse a request body as JSON, or return the 400 body to send back.
 * @param req
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | NextResponseType> {
  try {
    const body = await req.json();
    // `typeof` calls an array an object, so it needs saying separately: a JSON
    // array carries none of the named fields a handler goes on to read.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError('VALIDATION_FAILED', 'Request body must be a JSON object', 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    console.error('[api/v1] request body was not valid JSON', error);
    return jsonError('VALIDATION_FAILED', 'Request body must be JSON', 400);
  }
}

/**
 * True when a helper returned an error response rather than a value.
 * @param value
 */
export function isErrorResponse(value: unknown): value is NextResponseType {
  return value instanceof NextResponse;
}
