import { and, asc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/libs/DB';
import { projectSchema, workforcePortfolioEventSchema } from '@/models/Schema';
import { getWorkforceInventory } from '@/services/adoption/WorkforceService';
import { readWorkforceOutcomes } from '@/services/workforce/ledger';
import { readWorkforcePortfolio } from '@/services/workforce/portfolio';
import { authApi, isErrorResponse, jsonError, requireWorkspaceAdmin } from '../../_shared';

/**
 * Export a versioned snapshot for Transform. The authenticated workspace is the
 * only scope; an account admin never implicitly exports another workspace.
 * Existing operational records remain in Vocion. No write or credential is exposed.
 * @param req - Authenticated export request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'export transformation evidence');
  if (denied) {
    return denied;
  }
  const rawDays = new URL(req.url).searchParams.get('days') ?? '7';
  if (!['1', '7', '30', '90'].includes(rawDays)) {
    return jsonError('VALIDATION_FAILED', 'days must be 1, 7, 30, or 90', 400);
  }
  const days = Number(rawDays) as 1 | 7 | 30 | 90;
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const [workspace] = await db.select({ id: projectSchema.id, name: projectSchema.name }).from(projectSchema).where(eq(projectSchema.id, caller.orgId)).limit(1);
  if (!workspace) {
    return jsonError('NOT_FOUND', 'Workspace not found', 404);
  }
  const [inventory, portfolio, outcomes] = await Promise.all([
    getWorkforceInventory(caller.orgId, days),
    readWorkforcePortfolio(caller.orgId),
    readWorkforceOutcomes(caller.orgId, since, until, false),
  ]);
  const ids = portfolio.workflows.map(w => w.id);
  const history = ids.length
    ? await db.select({ workflowId: workforcePortfolioEventSchema.workflowId, version: workforcePortfolioEventSchema.version, createdAt: workforcePortfolioEventSchema.createdAt, actorId: workforcePortfolioEventSchema.actorId, data: workforcePortfolioEventSchema.data }).from(workforcePortfolioEventSchema).where(and(eq(workforcePortfolioEventSchema.orgId, caller.orgId), inArray(workforcePortfolioEventSchema.workflowId, ids))).orderBy(asc(workforcePortfolioEventSchema.createdAt), asc(workforcePortfolioEventSchema.version)).limit(20001)
    : [];
  if (!portfolio.complete || !outcomes.complete || history.length > 20000) {
    return jsonError('INCOMPLETE_EXPORT', 'Snapshot exceeds export limits. Narrow the period before importing.', 422);
  }
  if (portfolio.workflows.some(w => !history.some(h => h.workflowId === w.id && h.version === w.version) || history.some(h => h.workflowId === w.id && h.version > w.version))) {
    return jsonError('CONFLICT', 'A workflow changed during export. Please export again.', 409);
  }
  return NextResponse.json({ schemaVersion: 1, provider: 'vocion', workspace, generatedAt: new Date().toISOString(), complete: true, inventory, portfolio, history, outcomes }, {
    headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="vocion-transform-${caller.orgId}-${days}d.json"` },
  });
}
