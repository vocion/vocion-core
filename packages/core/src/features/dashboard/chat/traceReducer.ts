import type { TraceNode } from './types';

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
  return {
    ...prev,
    ...node,
    text: (prev?.text ?? '') + (delta ?? ''),
    citations: node.citations ?? prev?.citations,
    result: node.result ?? prev?.result,
    resultDetail: node.resultDetail ?? prev?.resultDetail,
    tool: node.tool ?? prev?.tool,
    args: node.args ?? prev?.args,
    detail: node.detail ?? prev?.detail,
  };
}

/**
 * When the turn lands, any node still "in progress" (a reason node that never
 * got a done boundary, a tool whose end event was lost) is marked done so the
 * transcript never shows a spinner forever. Errors stay errors.
 * @param trace
 */
export function finalizeTrace(trace: TraceNode[] | undefined): TraceNode[] {
  return (trace ?? []).map(n => (n.status === 'error' || n.status === 'done' ? n : { ...n, status: 'done' as const }));
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
