import { NextResponse } from 'next/server';
import { listWorkflows } from '@/services/WorkflowService';
import { authApi } from '../_shared';

/**
 * GET /api/v1/workflows
 *
 * Every workflow in the caller's workspace — slug, name, status, version and
 * how many steps it has. The full definition, including the input a run needs,
 * comes from `/api/v1/workflows/:slug`.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const workflows = await listWorkflows(auth.orgId);
  return NextResponse.json({
    workflows: workflows.map(w => ({
      slug: w.slug,
      name: w.name,
      description: w.description,
      status: w.status,
      version: w.version,
      stepCount: Array.isArray(w.steps) ? w.steps.length : 0,
      updatedAt: w.updatedAt,
    })),
  });
}
