import { createHash } from 'node:crypto';

type Meta = Record<string, unknown>;

/** The mark a record carries once a flow owns it: which run, and which generation. */
export type DurableMark = { workflowId: string; generation: number; startedAt: string; flowHash?: string };

/**
 * A short fingerprint of a flow definition: two runs on the same definition
 * share it, and a run started before the definition changed does not.
 * @param flow - The loaded flow.
 */
export function flowHash(flow: unknown): string {
  return createHash('sha256').update(JSON.stringify(flow)).digest('hex').slice(0, 16);
}

/**
 * The flow mark on a record, when it has one.
 * @param meta - The record's metadata.
 */
export function durableMarkOf(meta: Meta): DurableMark | null {
  const m = meta.durable as Partial<DurableMark> | undefined;
  return m && typeof m.workflowId === 'string' ? { workflowId: m.workflowId, generation: Number(m.generation) || 1, startedAt: String(m.startedAt ?? ''), ...(typeof m.flowHash === 'string' ? { flowHash: m.flowHash } : {}) } : null;
}

/**
 * Whether a record's next step belongs to its flow: it carries a mark and its
 * workspace runs that process durably (workspace.yaml `durable:`). The one
 * check a handler asks before it moves a record (backlog 054).
 * @param orgId - The workspace.
 * @param meta - The record's metadata.
 * @param process - The workspace's name for the process (the `durable:` entry).
 */
export async function ownedByFlow(orgId: string, meta: Meta, process: string): Promise<boolean> {
  if (!durableMarkOf(meta)) {
    return false;
  }
  const { durableOn } = await import('./flags');
  return durableOn(orgId, process);
}

/**
 * Make sure a record has a live run of its flow: a run that ended is followed
 * by a new generation; a live one is never doubled. The flow is read from its
 * plugin and snapshotted into the run's input.
 * @param o - What to start.
 * @param o.orgId - The workspace.
 * @param o.recordId - The record.
 * @param o.kind - The run id's kind segment (one owner per record and kind).
 * @param o.flowRef - `<plugin>/<name>`.
 * @param o.input - The flow's input.
 * @param o.readMeta - Reads the record's metadata.
 * @param o.writeMeta - Writes the mark onto the record.
 */
export async function ensureRecordFlow(o: {
  orgId: string;
  recordId: number;
  kind: string;
  flowRef: string;
  input: Meta;
  readMeta: () => Promise<Meta | null>;
  writeMeta: (patch: Meta) => Promise<void>;
}): Promise<{ workflowId: string; started: boolean }> {
  const { durable, durableIdFor } = await import('./index');
  const meta = await o.readMeta();
  const mark = meta ? durableMarkOf(meta) : null;
  if (mark && ['pending', 'enqueued'].includes(await durable().state(mark.workflowId))) {
    return { workflowId: mark.workflowId, started: false };
  }
  const generation = (mark?.generation ?? 0) + 1;
  const workflowId = durableIdFor(o.orgId, o.kind, `${o.recordId}.${generation}`);
  const { loadFlow } = await import('./flowDefinitions');
  const { FLOW_RUN } = await import('./flow');
  const flow = loadFlow(o.flowRef);
  await durable().start(FLOW_RUN, workflowId, { orgId: o.orgId, flowRef: o.flowRef, flow, input: o.input });
  await o.writeMeta({ durable: { workflowId, generation, startedAt: new Date().toISOString(), flowHash: flowHash(flow) } });
  return { workflowId, started: true };
}

/**
 * A RUN ON AN OLD FLOW IS RESTARTED ON THE CURRENT ONE (Walk 18, 2026-10-03:
 * FE-376 and FE-419 each kept the flow they started with, so two fixes to the
 * flow never reached them and each stopped again under the old rule). A run
 * keeps its snapshot by design (a step must replay the same way), so the
 * change reaches it as a new generation: when the record's run was started on
 * a different definition (or before runs carried one), the run is cancelled
 * and the next generation starts on the current flow. Callers do this only at
 * a safe point — a run waiting on a person, with nothing in flight.
 * @param o - As for {@link ensureRecordFlow}.
 * @param o.orgId - The workspace.
 * @param o.recordId - The record.
 * @param o.kind - The run id's kind segment.
 * @param o.flowRef - `<plugin>/<name>`.
 * @param o.input - The new generation's input.
 * @param o.readMeta - Reads the record's metadata.
 * @param o.writeMeta - Writes the mark onto the record.
 */
export async function restartOnCurrentFlow(o: Parameters<typeof ensureRecordFlow>[0]): Promise<{ restarted: boolean; workflowId: string | null }> {
  const meta = await o.readMeta();
  const mark = meta ? durableMarkOf(meta) : null;
  if (!mark) {
    return { restarted: false, workflowId: null };
  }
  const { loadFlow } = await import('./flowDefinitions');
  if (mark.flowHash === flowHash(loadFlow(o.flowRef))) {
    return { restarted: false, workflowId: mark.workflowId };
  }
  const { durable } = await import('./index');
  if (['pending', 'enqueued'].includes(await durable().state(mark.workflowId))) {
    await durable().cancel(mark.workflowId);
  }
  const run = await ensureRecordFlow(o);
  return { restarted: run.started, workflowId: run.workflowId };
}
