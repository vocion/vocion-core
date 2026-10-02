type Meta = Record<string, unknown>;

/**
 * THE FACTORY'S DOOR INTO ITS FLOW (backlog 054). In a workspace with
 * `durable: [factory]`, every way into a build (Build, chat, intake, an ask's
 * answer, a recovery, QA's send-back, an approved plan) is told to the
 * request's flow as a `factory.build_requested` event; the flow, which the
 * software-factory plugin ships as `workflows/request.yaml`, alone dispatches.
 * Core runs it with the generic flow engine (`libs/durable/flow.ts`).
 */
export const REQUEST_FLOW = 'software-factory/request';
export const BUILD_REQUESTED = 'factory.build_requested';
/** The workspace's name for the process (workspace.yaml `durable: [factory]`). */
export const FACTORY_PROCESS = 'factory';

/** A build asked for, by whom, and what this attempt should do differently. */
export type BuildIntent = {
  requestId: number;
  /** The person's id, or the factory step that asked. */
  by: string;
  byPerson: boolean;
  /** Where it came from: build, chat, recovery, qa, plan, ask, contract … */
  from: string;
  note?: string | null;
  planId?: number | null;
  trigger?: 'request' | 'recovery' | 'plan' | null;
};

export { type DurableMark, durableMarkOf } from '@/libs/durable/records';

/**
 * Whether this request's next step belongs to its flow, so a handler reacting
 * to an event leaves it alone. The one check every factory handler that would
 * move a request asks.
 * @param orgId - Tenant.
 * @param meta - The request's metadata.
 */
export async function ownedByWorkflow(orgId: string, meta: Meta): Promise<boolean> {
  const { ownedByFlow } = await import('@/libs/durable/records');
  return ownedByFlow(orgId, meta, FACTORY_PROCESS);
}

/**
 * Tell a request's flow a build was asked for: record the ask as a
 * `factory.build_requested` event (what the flow reads, and the audit of who
 * asked), and make sure a run is there to read it.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param intent - Who asked, and what this attempt should do differently.
 */
export async function askRequestWorkflow(orgId: string, requestId: number, intent: Omit<BuildIntent, 'requestId'>): Promise<Record<string, unknown>> {
  const { emitEvent } = await import('@/services/EventService');
  const { ensureRecordFlow } = await import('@/libs/durable/records');
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const since = new Date(Date.now() - 1000).toISOString();
  await emitEvent({ orgId, type: BUILD_REQUESTED, payload: { requestId, ...intent }, invokedBy: intent.by });
  const run = await ensureRecordFlow({
    orgId,
    recordId: requestId,
    kind: 'request',
    flowRef: REQUEST_FLOW,
    input: { requestId, since },
    readMeta: async () => (await readRecord(orgId, requestId))?.meta ?? null,
    writeMeta: patch => writeMeta(orgId, requestId, patch),
  });
  return run.started
    ? { owner: 'workflow', workflowId: run.workflowId, requestId, line: 'Started the request\'s workflow; it takes the build from here.' }
    : { owner: 'workflow', workflowId: run.workflowId, requestId, line: 'Told the request\'s workflow; it takes the build from here.' };
}
