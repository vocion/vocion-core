import { NextResponse } from 'next/server';
import { listWorkflows } from '@/services/WorkflowService';
import { authApi } from '../_shared';

export async function GET() {
  const auth = await authApi();
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
