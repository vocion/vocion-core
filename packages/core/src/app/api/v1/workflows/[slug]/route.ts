import { NextResponse } from 'next/server';
import { getWorkflow, startWorkflow } from '@/services/WorkflowService';
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

/**
 * Start a workflow run. Body shape:
 *   { input?: Record<string, unknown>, triggerContext?: Record<string, unknown> }
 *
 * Returns the same `WorkflowRunSummary` shape `startWorkflow` resolves to —
 * callers (UI form, seed-tickets script, future MCP triggers) read the
 * `id` and route to `/dashboard/workflows/<slug>/runs/<id>` for the live
 * stepper.
 *
 * Input validation: relies on `startWorkflow` + the underlying step
 * executors to fail fast on missing required fields. The workflow's
 * `inputSchema` (returned by GET) tells callers what to send. A future
 * iteration can Zod-validate here against the declared inputSchema before
 * starting the run, but for v0.4 the executor's own validation is enough.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return jsonError('INVALID_BODY', 'Request body must be a JSON object', 400);
  }
  const parsed = body as { input?: unknown; triggerContext?: unknown; invokedBy?: unknown } | null;
  const input = parsed?.input;
  const triggerContext = parsed?.triggerContext;
  const invokedBy = parsed?.invokedBy;

  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    return jsonError('INVALID_BODY', '`input` must be a JSON object', 400);
  }
  if (triggerContext !== undefined && (typeof triggerContext !== 'object' || triggerContext === null || Array.isArray(triggerContext))) {
    return jsonError('INVALID_BODY', '`triggerContext` must be a JSON object', 400);
  }
  if (invokedBy !== undefined && typeof invokedBy !== 'string') {
    return jsonError('INVALID_BODY', '`invokedBy` must be a string', 400);
  }

  try {
    const summary = await startWorkflow({
      orgId: auth.orgId,
      slug,
      input: (input as Record<string, unknown> | undefined),
      triggerContext: (triggerContext as Record<string, unknown> | undefined),
      invokedBy: invokedBy as string | undefined,
    });
    return NextResponse.json(summary, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      return jsonError('NOT_FOUND', message, 404);
    }
    if (message.includes('is ') && message.includes('cannot start')) {
      return jsonError('WORKFLOW_NOT_ACTIVE', message, 409);
    }
    return jsonError('WORKFLOW_START_FAILED', message, 500);
  }
}
