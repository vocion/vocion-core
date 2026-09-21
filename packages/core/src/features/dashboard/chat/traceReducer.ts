import type { TraceNode } from './types';
import type { ArtifactPayload } from '@/services/agents/types';
import { stepLabelFor, stepProgressLabel } from '@/libs/chat/stepLabels';

/**
 * Fold one `trace_node` SSE event into the turn's accumulating trace.
 *
 * Pure, so the live rail and the tests can agree on exactly what a node looks
 * like mid-turn: a `delta` appends to the node's text (reason nodes stream
 * their thinking this way), every other field is "latest wins, absent keeps
 * the old value" — a `done` event that carries only `status` and `result`
 * must not blank the `detail` the `start` event set.
 * @param prev - The node as accumulated so far, if any.
 * @param event - The incoming event (a TraceNode plus an optional `delta`).
 */
export function mergeTraceNode(prev: TraceNode | undefined, event: TraceNode & { delta?: string }): TraceNode {
  const { delta, ...node } = event;
  const labels = node.labels ?? prev?.labels;
  const merged: TraceNode = {
    ...prev,
    ...node,
    text: (prev?.text ?? '') + (delta ?? ''),
    citations: node.citations ?? prev?.citations,
    result: node.result ?? prev?.result,
    resultDetail: node.resultDetail ?? prev?.resultDetail,
    tool: node.tool ?? prev?.tool,
    args: node.args ?? prev?.args,
    detail: node.detail ?? prev?.detail,
    labels,
  };
  // A progress note describes the call while it runs. The moment it lands the
  // note is gone — a finished step reads "Rendered the document", never
  // "Rendered the document sheet 11 of 12".
  const progress = node.progress ?? prev?.progress;
  if (progress && merged.status !== 'done' && merged.status !== 'error') {
    merged.progress = progress;
  } else {
    delete merged.progress;
  }
  // Once the pair is known the tense follows the status, whichever event
  // carried which: a `done` that predates the labeler's patch, or a patch
  // that arrives after `done`, both read "Read the brand guide".
  if (labels && merged.status !== 'error') {
    merged.label = stepLabelFor(labels, merged.status);
  }
  return merged;
}

/**
 * When the turn lands, any node still "in progress" (a reason node that never
 * got a done boundary, a tool whose end event was lost) is marked done so the
 * transcript never shows a spinner forever. Errors stay errors.
 * @param trace
 */
export function finalizeTrace(trace: TraceNode[] | undefined): TraceNode[] {
  return (trace ?? []).map((n) => {
    if (n.status === 'error' || n.status === 'done') {
      return n;
    }
    const { progress: _dropped, ...rest } = n;
    return { ...rest, status: 'done' as const, ...(n.labels ? { label: stepLabelFor(n.labels, 'done') } : {}) };
  });
}

/**
 * Note where an in-flight tool call has got to, from a `step_progress` event.
 *
 * The event names the tool, not the node — a tool does not know its own trace
 * id — so the newest step still running under that name takes the note, the
 * same way `failToolNode` closes one from a `tool_error`. Nothing matches?
 * The trace comes back untouched: a note is never worth inventing a step for.
 * @param trace - The turn's trace so far.
 * @param tool - Raw tool name from the event, e.g. `render_document`.
 * @param note - The phrase to show, e.g. `sheet 7 of 12`.
 */
export function noteToolProgress(trace: TraceNode[] | undefined, tool: string, note: string): TraceNode[] {
  const nodes = trace ?? [];
  const phrase = note.trim();
  if (!phrase) {
    return nodes;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.tool === tool && (n.status === 'start' || n.status === 'progress')) {
      return [...nodes.slice(0, i), { ...n, status: 'progress', progress: phrase }, ...nodes.slice(i + 1)];
    }
  }
  return nodes;
}

/**
 * What the live line says for a step: its label, plus where the call has got
 * to when it has said.
 * @param node - The step.
 */
export function liveStepLabel(node: Pick<TraceNode, 'label' | 'progress'>): string {
  return stepProgressLabel(node.label, node.progress);
}

/**
 * Mark the in-flight tool node that matches a `tool_error` event as failed.
 * The runtime does not always emit a `trace_node` error for a thrown tool, so
 * the client closes the row itself from the error's tool name.
 * @param trace
 * @param tool - Raw tool name from the `tool_error` event.
 * @param message
 */
export function failToolNode(trace: TraceNode[] | undefined, tool: string, message: string): TraceNode[] {
  const nodes = trace ?? [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.status !== 'done' && n.status !== 'error' && (n.tool === tool || n.label.toLowerCase().includes(tool.replaceAll(/[-_]/g, ' ')))) {
      return [...nodes.slice(0, i), { ...n, status: 'error', result: message.slice(0, 160) }, ...nodes.slice(i + 1)];
    }
  }
  return nodes;
}

/**
 * How the live rail summarises the turn so far: what the agent is doing now
 * (the newest in-flight node's label), how many steps have landed, and how
 * long the reasoning has been going.
 * @param trace
 */
export function summarizeLiveTrace(trace: TraceNode[]): { current: TraceNode | null; steps: number; done: number } {
  const roots = trace.filter(n => !n.parentId && n.kind !== 'reason');
  const inflight = [...trace].reverse().find(n => n.status === 'start' || n.status === 'progress') ?? null;
  return { current: inflight, steps: roots.length, done: roots.filter(n => n.status === 'done' || n.status === 'error').length };
}

/**
 * Fold one `artifact` SSE event into the artifact the pane is showing.
 *
 * Three shapes arrive on the same event type and the pane must not confuse
 * them:
 *
 *   `pending: true`  a shell — the title is known, the body is not. The row
 *                    does not exist yet, so its id is a placeholder.
 *   `delta`          more markdown for the pending body; appends.
 *   neither          the settled row. It REPLACES the accumulated body, so a
 *                    dropped or duplicated delta cannot leave the pane
 *                    showing something the database does not hold.
 *
 * Pure, so the pane and the tests agree on what a half-written artifact looks
 * like mid-turn.
 * @param prev - The artifact as accumulated so far, if any.
 * @param event - The incoming event.
 * @param event.artifact
 * @param event.pending
 * @param event.delta
 */
export function mergeArtifactEvent(
  prev: (ArtifactPayload & { pending?: boolean }) | undefined,
  event: { artifact: ArtifactPayload; pending?: boolean; delta?: string },
): ArtifactPayload & { pending?: boolean } {
  if (event.pending) {
    const md = `${String(prev?.pending ? prev.spec?.md ?? '' : '')}${event.delta ?? ''}`;
    return {
      ...(prev ?? event.artifact),
      ...event.artifact,
      spec: { ...event.artifact.spec, ...(md ? { md } : {}) },
      pending: true,
    };
  }
  if (event.delta && prev?.pending) {
    return { ...prev, spec: { ...prev.spec, md: `${String(prev.spec?.md ?? '')}${event.delta}` }, pending: true };
  }
  return { ...event.artifact, pending: false };
}
