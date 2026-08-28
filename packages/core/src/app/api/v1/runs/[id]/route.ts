import { NextResponse } from 'next/server';
import { getWorkflowRun } from '@/services/WorkflowService';
import { authApi, jsonError } from '../../_shared';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { id: idStr } = await context.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return jsonError('VALIDATION_FAILED', 'Run id must be an integer', 400);
  }

  const workflowRun = await getWorkflowRun(id, auth.orgId);
  if (workflowRun) {
    return NextResponse.json({
      id: workflowRun.id,
      kind: 'workflow',
      slug: workflowRun.workflowSlug,
      status: workflowRun.status,
      stepResults: workflowRun.stepResults,
      workspaceSha: workflowRun.workspaceSha,
      error: workflowRun.error,
      createdAt: workflowRun.createdAt,
      completedAt: workflowRun.completedAt,
    });
  }

  return jsonError('NOT_FOUND', `No run found with id ${id}`, 404);
}
