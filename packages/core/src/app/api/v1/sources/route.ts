import { NextResponse } from 'next/server';
import { apiListSources, apiUpsertSource } from '@/services/writeApi';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireCapability, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/sources
 *
 * Every source this org has, each with its latest sync checkpoint:
 * `{ slug, name, connector, enabled, lastSyncedAt, documentCount, run }`, where
 * `run` carries `status`, `startedAt`, `completedAt`, `since`, `counts` and
 * `failures`, the last of which is how a processor failure is visible to a
 * tenant's own reporting without a database connection.
 *
 * Requires the `manage_sources` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  try {
    return NextResponse.json(await apiListSources(caller));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}

/**
 * POST /api/v1/sources
 *
 * Create or REPLACE a source, by slug. Body:
 * `{ slug, name, kind, config, schedule?, reconcileSchedule?, enabled?, processor? }`.
 * Answers `{ source: { slug, created } }`.
 *
 * This is the writer of record for a tenant that owns its own source list: the
 * stored config blob is replaced wholesale, so a changed source actually
 * changes. The dashboard's edit path is the one that preserves keys it did not
 * author; this one does not, deliberately.
 *
 * Requires the `manage_sources` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  if (body.processor !== undefined && (typeof body.processor !== 'object' || body.processor === null || Array.isArray(body.processor) || typeof (body.processor as { slug?: unknown }).slug !== 'string')) {
    return jsonError('VALIDATION_FAILED', 'processor must be an object with a slug', 400);
  }
  try {
    return NextResponse.json(await apiUpsertSource(caller, {
      slug: body.slug as string,
      name: body.name as string | undefined,
      kind: body.kind as string,
      config: body.config as Record<string, unknown>,
      schedule: body.schedule as string | undefined,
      reconcileSchedule: body.reconcileSchedule as string | false | undefined,
      enabled: body.enabled as boolean | undefined,
      processor: body.processor as { slug: string; config?: Record<string, unknown> } | undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
