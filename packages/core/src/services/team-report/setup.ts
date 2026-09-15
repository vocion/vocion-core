/**
 * Setup state — is this workforce configured enough to report on?
 * (docs/specs/team-report-v2.md §10). A report full of zeroes makes the
 * product look dead; a checklist makes it look unfinished, which is the
 * truth. Pure.
 */

import type { TeamMeasure } from './measures';

export type SetupReason = 'no-goal' | 'no-measures' | 'no-work';

export type SetupItem = {
  key: 'goal' | 'measures' | 'unassigned' | 'autonomy';
  label: string;
  status: 'ok' | 'missing' | 'info';
  /** The reading a person sees: "Missing", "1 of 4 configured", "Human approval default". */
  detail: string;
};

export type SetupState = {
  /** Render the setup page instead of the report. */
  needed: boolean;
  reasons: SetupReason[];
  items: SetupItem[];
  /** Teams with at least one measure / teams. */
  measured: { configured: number; total: number };
  /** How many items are still missing — the headline count. */
  missing: number;
};

/**
 * Judge the workspace. Setup is needed when any of the three things the
 * report cannot exist without is absent: a workspace outcome, at least one
 * measured team, or any completed work at all. "Ever" rather than "in the
 * window", deliberately — a configured workforce that was quiet over a
 * weekend has a quiet report, not a broken one.
 * @param input - What the workspace has.
 * @param input.goal - `project.goal`.
 * @param input.teams - Each team's effective measures.
 * @param input.unassignedAgents - Agents on no team.
 * @param input.completedWorkEver - Completed worker runs + executed actions, all time.
 * @param input.autoExecuteActions - Action kinds with an enabled trust rule.
 */
export function detectSetupState(input: {
  goal: string | null;
  teams: { slug: string; measures: TeamMeasure[] }[];
  unassignedAgents: number;
  completedWorkEver: number;
  autoExecuteActions: number;
}): SetupState {
  const configured = input.teams.filter(t => t.measures.length > 0).length;
  const total = input.teams.length;
  const reasons: SetupReason[] = [];
  if (!input.goal) {
    reasons.push('no-goal');
  }
  if (configured === 0) {
    reasons.push('no-measures');
  }
  if (input.completedWorkEver === 0) {
    reasons.push('no-work');
  }
  const items: SetupItem[] = [
    { key: 'goal', label: 'Workspace outcome', status: input.goal ? 'ok' : 'missing', detail: input.goal ? 'Set' : 'Missing' },
    { key: 'measures', label: 'Team measures', status: configured === 0 ? 'missing' : configured < total ? 'info' : 'ok', detail: total === 0 ? 'No teams yet' : `${configured} of ${total} configured` },
    { key: 'unassigned', label: 'Unassigned agents', status: input.unassignedAgents > 0 ? 'info' : 'ok', detail: input.unassignedAgents === 0 ? 'None' : String(input.unassignedAgents) },
    { key: 'autonomy', label: 'Autonomy policy', status: 'info', detail: input.autoExecuteActions === 0 ? 'Human approval default' : `${input.autoExecuteActions} action ${input.autoExecuteActions === 1 ? 'kind' : 'kinds'} auto-execute` },
  ];
  return {
    needed: reasons.length > 0,
    reasons,
    items,
    measured: { configured, total },
    missing: items.filter(i => i.status === 'missing').length,
  };
}
