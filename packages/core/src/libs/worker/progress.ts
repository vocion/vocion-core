/**
 * WHAT A RUNNING WORKER SAYS ABOUT ITSELF (backlog 007, slice a).
 *
 * A heartbeat's `progress` is free JSON, and a person watching a build from a
 * phone needs three things from it: the step the worker is on, the last few
 * lines it printed, and the checks it has run so far. The worker sends them
 * under these names; core keeps them bounded so a chatty build never grows a
 * row past what a page can show or a heartbeat can carry.
 */

export type WorkerTraceNode = { at: string; label: string; status?: 'running' | 'done' | 'failed' };

export type WorkerProgress = {
  /** What the worker is doing now, one line — "running typecheck", "opening the pull request". */
  step?: string;
  /** The tail of what it printed, oldest first. */
  log?: string[];
  /** The checks and steps so far, in order. */
  trace?: WorkerTraceNode[];
  [key: string]: unknown;
};

export const MAX_LOG_LINES = 40;
export const MAX_LINE_CHARS = 300;
export const MAX_TRACE_NODES = 50;

/**
 * The progress a heartbeat carried, bounded: the last 40 log lines of at most
 * 300 characters, the last 50 trace nodes, a one-line step. Anything else the
 * worker put in `progress` is kept as it came.
 * @param raw - The heartbeat's `progress`.
 */
export function boundProgress(raw: Record<string, unknown>): WorkerProgress {
  const out: WorkerProgress = { ...raw };
  if (typeof raw.step === 'string') {
    out.step = raw.step.trim().slice(0, 200);
  } else {
    delete out.step;
  }
  if (Array.isArray(raw.log)) {
    out.log = raw.log.filter((l): l is string => typeof l === 'string').map(l => l.slice(0, MAX_LINE_CHARS)).slice(-MAX_LOG_LINES);
  } else {
    delete out.log;
  }
  if (Array.isArray(raw.trace)) {
    out.trace = raw.trace
      .filter((n): n is WorkerTraceNode => !!n && typeof n === 'object' && typeof (n as WorkerTraceNode).label === 'string' && typeof (n as WorkerTraceNode).at === 'string')
      .map(n => ({ at: n.at, label: n.label.slice(0, 200), ...(n.status === 'running' || n.status === 'done' || n.status === 'failed' ? { status: n.status } : {}) }))
      .slice(-MAX_TRACE_NODES);
  } else {
    delete out.trace;
  }
  return out;
}
