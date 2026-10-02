type Meta = Record<string, unknown>;

/** The mark a record carries once a flow owns it: which run, and which generation. */
export type DurableMark = { workflowId: string; generation: number; startedAt: string };

/**
 * The flow mark on a record, when it has one.
 * @param meta - The record's metadata.
 */
export function durableMarkOf(meta: Meta): DurableMark | null {
  const m = meta.durable as Partial<DurableMark> | undefined;
  return m && typeof m.workflowId === 'string' ? { workflowId: m.workflowId, generation: Number(m.generation) || 1, startedAt: String(m.startedAt ?? '') } : null;
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
  await durable().start(FLOW_RUN, workflowId, { orgId: o.orgId, flowRef: o.flowRef, flow: loadFlow(o.flowRef), input: o.input });
  await o.writeMeta({ durable: { workflowId, generation, startedAt: new Date().toISOString() } });
  return { workflowId, started: true };
}
