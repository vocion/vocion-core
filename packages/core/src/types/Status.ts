/**
 * Status taxonomy — every status string the system emits, typed as
 * discriminated unions so the `<StatusPill>` switch is exhaustive at
 * compile time.
 *
 * Adding a new status here without giving it a visual treatment in
 * `components/ui/status-pill.tsx` is a TypeScript error.
 */

/** Skill / Workflow / Eval run lifecycle. */
export type RunStatus
  = | 'pending'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'approved'
    | 'rejected'
    | 'auto';

/** Catalog-entity enabled-state — Agents, Skills, Workflows, Sources. */
export type EntityStatus
  = | 'active'
    | 'inactive'
    | 'configured'
    | 'unconfigured';

/** Agent's self-assessment of an answer's confidence. Nullable upstream. */
export type ConfidenceLevel
  = | 'confident'
    | 'uncertain'
    | 'speculative';

/**
 * Union of every status the `<StatusPill>` knows how to render.
 * `Status` is intentionally a discriminated union of three semantic
 * groups so callers can narrow by domain when it matters.
 */
export type Status = RunStatus | EntityStatus;

/**
 * Type guard — `RunStatus` strings only. Useful when narrowing a
 * server payload that might carry either entity status or run status.
 * @param s
 */
export function isRunStatus(s: string): s is RunStatus {
  return (
    s === 'pending'
    || s === 'running'
    || s === 'paused'
    || s === 'completed'
    || s === 'failed'
    || s === 'cancelled'
    || s === 'approved'
    || s === 'rejected'
    || s === 'auto'
  );
}

export function isEntityStatus(s: string): s is EntityStatus {
  return s === 'active' || s === 'inactive' || s === 'configured' || s === 'unconfigured';
}
