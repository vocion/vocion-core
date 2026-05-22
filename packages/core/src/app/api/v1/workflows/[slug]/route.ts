import { NextResponse } from 'next/server';
import { getWorkflow } from '@/services/WorkflowService';
import { authApi, jsonError } from '../../_shared';

export async function GET(_req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;
  const workflow = await getWorkflow(auth.orgId, slug);
  if (!workflow) {
    return jsonError('NOT_FOUND', `No workflow found for slug "${slug}"`, 404);
  }
  return NextResponse.json({
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    version: workflow.version,
    trigger: workflow.trigger,
    inputSchema: workflow.inputSchema,
    steps: workflow.steps,
  });
}
