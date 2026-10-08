import type { AccessAction } from '@/services/access/accessLog';
import type { AccessActorKind } from '@/services/access/AccessLogService';
import { NextResponse } from 'next/server';
import { ACCESS_ACTIONS } from '@/services/access/accessLog';
import { ACCESS_ACTOR_KINDS, accessLogRetentionDays, listAccessEvents } from '@/services/access/AccessLogService';
import { authApi, isErrorResponse, jsonError, readPagination, requireWorkspaceAdmin } from '../_shared';

/**
 * Parse an ISO date query value; undefined when absent, null when unreadable.
 * @param raw - The value.
 */
function readDate(raw: string | null): Date | undefined | null {
  if (!raw) {
    return undefined;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/v1/access-log
 *
 * Who read which record in this workspace, and when — newest first. One entry
 * per view, download, export or search, by a person, an agent on a run, an API
 * token or a public share link:
 * `{ events: [{ id, at, action, actorKind, actorId, onBehalfOf, runKind, runId, recordKind, recordId, via, ipHash, uaHash, detail }], hasMore, retentionDays }`.
 * Addresses and user agents are keyed hashes, never the values. Only this
 * workspace's reads; there is no account-wide view.
 *
 * Query parameters:
 * - `action` — `view`, `download`, `export` or `search`.
 * - `actorKind` — `user`, `agent`, `token` or `link`.
 * - `actor` — a user id, an agent slug or `token:<id>`; also matches what an agent read for that person.
 * - `recordKind` — `object`, `artifact`, `document`, `file`, …
 * - `recordId` — the record's id; with `recordKind`, everyone who read that one record.
 * - `since`, `until` — ISO 8601 bounds on when.
 *
 * Requires a workspace admin.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const notAdmin = requireWorkspaceAdmin(caller, 'read the access log');
  if (notAdmin) {
    return notAdmin;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  const action = url.searchParams.get('action') || undefined;
  if (action && !(ACCESS_ACTIONS as readonly string[]).includes(action)) {
    return jsonError('VALIDATION_FAILED', `action must be one of ${ACCESS_ACTIONS.join(', ')}`, 400);
  }
  const actorKind = url.searchParams.get('actorKind') || undefined;
  if (actorKind && !(ACCESS_ACTOR_KINDS as readonly string[]).includes(actorKind)) {
    return jsonError('VALIDATION_FAILED', `actorKind must be one of ${ACCESS_ACTOR_KINDS.join(', ')}`, 400);
  }
  const since = readDate(url.searchParams.get('since'));
  const until = readDate(url.searchParams.get('until'));
  if (since === null || until === null) {
    return jsonError('VALIDATION_FAILED', 'since and until must be ISO 8601 dates', 400);
  }
  const page = await listAccessEvents(caller.orgId, {
    action: action as AccessAction | undefined,
    actorKind: actorKind as AccessActorKind | undefined,
    actorId: url.searchParams.get('actor') || undefined,
    recordKind: url.searchParams.get('recordKind') || undefined,
    recordId: url.searchParams.get('recordId') || undefined,
    since,
    until,
    limit,
    offset,
  });
  return NextResponse.json({
    events: page.events.map(({ orgId: _org, accountId: _account, ...event }) => event),
    hasMore: page.hasMore,
    retentionDays: accessLogRetentionDays(),
  });
}
