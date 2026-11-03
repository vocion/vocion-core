import { NextResponse } from 'next/server';
import { crmDashboard } from '@/services/crm/dashboard';
import { startCrmSync } from '@/services/crm/jobs';
import { ListError } from '@/services/lists/service';
import { authApi, isErrorResponse, jsonError } from '../_shared';

/**
 * Read the workspace CRM funnel, source freshness and delivery hold.
 * Requires a browser session and matching workspace query parameter.
 * @param req - Authenticated request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  if (caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'CRM requires a signed-in person', 403);
  }
  if (new URL(req.url).searchParams.get('workspace') !== caller.orgId) {
    return jsonError('WORKSPACE_CHANGED', 'The active workspace changed. Reload this page before continuing.', 409);
  }
  const actor = { orgId: caller.orgId, userId: caller.actorId };
  try {
    return NextResponse.json(await crmDashboard(actor), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError('CRM_ERROR', error instanceof ListError ? error.message : 'CRM could not be loaded. Retry or check the HubSpot connection.', error instanceof ListError ? error.status : 500);
  }
}

/**
 * Queue a resumable HubSpot import without sending email. Requires workspace admin.
 * Requires a browser session and matching workspace query parameter.
 * @param req - Authenticated request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  if (caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'CRM requires a signed-in person', 403);
  }
  if (new URL(req.url).searchParams.get('workspace') !== caller.orgId) {
    return jsonError('WORKSPACE_CHANGED', 'The active workspace changed. Reload this page before continuing.', 409);
  }
  const actor = { orgId: caller.orgId, userId: caller.actorId };
  try {
    return NextResponse.json(await startCrmSync(actor), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError('CRM_ERROR', error instanceof ListError ? error.message : 'CRM could not be loaded. Retry or check the HubSpot connection.', error instanceof ListError ? error.status : 500);
  }
}
