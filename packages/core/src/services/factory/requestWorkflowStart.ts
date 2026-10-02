import type { BuildIntent } from './requestWorkflow';

type Meta = Record<string, unknown>;

/** The ownership mark a request carries once its workflow owns it. */
export type DurableMark = { workflowId: string; generation: number; startedAt: string };

/**
 * The workflow mark on a request, when it has one.
 * @param meta - The request's metadata.
 */
export function durableMarkOf(meta: Meta): DurableMark | null {
  const m = meta.durable as Partial<DurableMark> | undefined;
  return m && typeof m.workflowId === 'string' ? { workflowId: m.workflowId, generation: Number(m.generation) || 1, startedAt: String(m.startedAt ?? '') } : null;
}

/**
 * Whether this request's next step belongs to its workflow, so a handler
 * reacting to an event leaves it alone. The one check every factory handler
 * that would move a request asks (backlog 054).
 * @param orgId - Tenant.
 * @param meta - The request's metadata.
 */
export async function ownedByWorkflow(orgId: string, meta: Meta): Promise<boolean> {
  if (!durableMarkOf(meta)) {
    return false;
  }
  const { durableOn } = await import('@/libs/durable/flags');
  return durableOn(orgId, 'factory');
}

/**
 * Tell a request's workflow a build was asked for: record the ask as a
 * `factory.build_requested` event (what the workflow reads, and the audit of
 * who asked), and make sure a workflow is there to read it. A run that ended
 * (live, idle) is followed by a new generation; a live one is never doubled.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param intent - Who asked, and what this attempt should do differently.
 */
export async function askRequestWorkflow(orgId: string, requestId: number, intent: Omit<BuildIntent, 'requestId'>): Promise<Record<string, unknown>> {
  const { emitEvent } = await import('@/services/EventService');
  const { durable, durableIdFor } = await import('@/libs/durable');
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const { BUILD_REQUESTED, REQUEST_WORKFLOW } = await import('./requestWorkflow');
  const since = new Date(Date.now() - 1000).toISOString();
  await emitEvent({ orgId, type: BUILD_REQUESTED, payload: { requestId, ...intent }, invokedBy: intent.by });
  const request = await readRecord(orgId, requestId);
  const mark = request ? durableMarkOf(request.meta) : null;
  const live = mark ? ['pending', 'enqueued'].includes(await durable().state(mark.workflowId)) : false;
  if (mark && live) {
    return { owner: 'workflow', workflowId: mark.workflowId, requestId, line: 'Told the request\'s workflow; it takes the build from here.' };
  }
  const generation = (mark?.generation ?? 0) + 1;
  const workflowId = durableIdFor(orgId, 'request', `${requestId}.${generation}`);
  await import('./requestWorkflow');
  await durable().start(REQUEST_WORKFLOW, workflowId, { orgId, requestId, since });
  const startedAt = new Date().toISOString();
  await writeMeta(orgId, requestId, { durable: { workflowId, generation, startedAt } });
  return { owner: 'workflow', workflowId, requestId, line: 'Started the request\'s workflow; it takes the build from here.' };
}
