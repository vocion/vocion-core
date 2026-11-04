import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ListValidationError } from '@/libs/lists/spec';
import { campaignCommand, campaignPlans, changeCampaign } from '@/services/crm/campaigns';
import { ListError } from '@/services/lists/service';
import { authApi, isErrorResponse, jsonError } from '../../_shared';

/**
 * Read campaign drafts and revision-bound review receipts.
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
    const query = z.object({ kind: z.enum(['weekly', 'outreach']).default('weekly'), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).parse(Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(await campaignPlans(actor, query.kind, query.offset), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof ListValidationError) {
      return jsonError('INVALID_REQUEST', error instanceof ListValidationError ? error.message : 'Invalid campaign request', 400);
    }
    return jsonError('CRM_ERROR', error instanceof ListError ? error.message : 'CRM could not be loaded. Retry or check the HubSpot connection.', error instanceof ListError ? error.status : 500);
  }
}

/**
 * Save a campaign draft or review a revision. Reviews require workspace admin; delivery stays held.
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
    return NextResponse.json(await changeCampaign(actor, campaignCommand.parse(await req.json())), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof ListValidationError) {
      return jsonError('INVALID_REQUEST', error instanceof ListValidationError ? error.message : 'Invalid campaign request', 400);
    }
    return jsonError('CRM_ERROR', error instanceof ListError ? error.message : 'CRM could not be loaded. Retry or check the HubSpot connection.', error instanceof ListError ? error.status : 500);
  }
}
