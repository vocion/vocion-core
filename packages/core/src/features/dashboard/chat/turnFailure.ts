import type { AgentRun, TraceNode } from './types';

/**
 * A FAILURE THE TURN RECOVERED FROM IS NOT A RED CHIP.
 *
 * Journey 4 (2026-09-28): the product manager's first `file_request` call
 * was refused by its schema, the owed-write pass filed the record a moment
 * later, and the answer said "Filed as request #214" — under a red
 * "file_request failed" chip. The chip read the first error in the turn and
 * nothing after it, so a success wore the badge of the attempt before it.
 *
 * A failed step is RESOLVED when a later step of the same kind succeeded:
 * the same tool, or — for the filing tools, which are one act in different
 * shapes (`file_<type>`, `propose_action`) — any filing tool. What is left
 * unresolved is what the badge shows; a resolved one is a quiet
 * "retried · filed" beside the header, and the trace still holds both steps.
 */

type ToolRun = Extract<AgentRun, { type: 'tool' }>;

/**
 * A step that records something: one act whichever shape the call took.
 * @param name
 */
function isFilingTool(name: string): boolean {
  return /^file_[a-z0-9_]+$/.test(name) || name === 'propose_action';
}

/**
 * Do these two steps do the same job?
 * @param a - A tool name.
 * @param b - Another.
 */
function sameKind(a: string, b: string): boolean {
  return a === b || (isFilingTool(a) && isFilingTool(b));
}

/** An answer that is a refusal in words, though the step itself returned. */
const REFUSED_OUTPUT = /^\s*(?:not recorded|refused|update refused|error|failed)\b/i;

function succeeded(run: ToolRun): boolean {
  return run.state === 'done' && !REFUSED_OUTPUT.test(run.output ?? '');
}

export type TurnFailure = {
  /** The failed run the badge names, when one is still unresolved. */
  run?: ToolRun;
  /** The failed trace node the badge names, when one is still unresolved. */
  node?: TraceNode;
  /** A failed step a later step of the same kind recovered from, by tool name. */
  retried?: { tool: string; filed: boolean };
};

/**
 * The turn's failure as the header should show it.
 * @param runs - The turn's runs, in order.
 * @param trace - The turn's typed trace, in order.
 */
export function turnFailure(runs: readonly AgentRun[], trace: readonly TraceNode[] = []): TurnFailure {
  const tools = runs.filter((r): r is ToolRun => r.type === 'tool');
  const recoveredLater = (name: string, from: number): boolean =>
    tools.slice(from + 1).some(r => sameKind(r.name, name) && succeeded(r));
  let retried: TurnFailure['retried'];
  let run: ToolRun | undefined;
  tools.forEach((r, i) => {
    if (r.state !== 'error' || run) {
      return;
    }
    if (recoveredLater(r.name, i)) {
      retried ??= { tool: r.name, filed: isFilingTool(r.name) };
    } else {
      run = r;
    }
  });
  let node: TraceNode | undefined;
  trace.forEach((n, i) => {
    if (n.status !== 'error' || node) {
      return;
    }
    const name = n.tool ?? '';
    const laterNode = name !== '' && trace.slice(i + 1).some(m => m.tool !== undefined && sameKind(m.tool, name) && m.status === 'done');
    // Runs and trace nodes are two lists with no shared clock: the node is
    // recovered when the LAST run of its kind succeeded.
    const lastRun = [...tools].reverse().find(r => sameKind(r.name, name));
    const laterRun = name !== '' && lastRun !== undefined && succeeded(lastRun);
    if (laterNode || laterRun) {
      retried ??= { tool: name, filed: isFilingTool(name) };
    } else {
      node = n;
    }
  });
  return { ...(run ? { run } : {}), ...(node ? { node } : {}), ...(retried && !run && !node ? { retried } : {}) };
}
