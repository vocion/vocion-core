/**
 * What a workflow run records for each step (`workflow_run.step_results`,
 * keyed by step name). Written by the engine (`services/WorkflowService.ts`),
 * read by the run page, the review queue and the work lists.
 */

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval' | 'skipped';

export type StepResult = {
  status: StepStatus;
  /** What a person reads for this step, interpolated when it started: "Editor review · round 2 of 3". */
  label?: string;
  output?: unknown;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** How many times the step was started: more than one means a restart interrupted it and it ran again. */
  attempt?: number;
  /** Why a skipped step was skipped: its `when`, as authored. */
  skippedBecause?: string;
  /** Inside a repeat group: the round this result is from. */
  round?: number;
  /** Inside a repeat group: what earlier rounds produced, oldest first. */
  previous?: Array<{ round: number; status: StepStatus; output?: unknown; error?: string; finishedAt?: string }>;
  /** A repeat group's place: the round it is on and the next of its steps to run. */
  repeat?: { round: number; max: number; next: number; satisfied?: boolean; exhausted?: boolean };
  /** An agent step's turns: who did it, how hard, what it cost, and each try at the result. */
  agent?: {
    slug: string;
    attempts: Array<{ at: string; traceId: string; ok: boolean; problem?: string }>;
    model?: string;
    effort?: string;
    microCents?: number;
    toolCalls: number;
  };
  /** An approve step's Decision (`ask.id`), while it waits and after. */
  askId?: number;
  /** Legacy: the operation run of a pre-0.2 `skill` step. */
  skillRunId?: number;
};

/**
 * A step that has stopped moving on its own.
 * @param status
 */
export function isSettled(status: StepStatus | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'skipped';
}
