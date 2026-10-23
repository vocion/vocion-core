import type { GoalStatus, NextStep } from '@/libs/objectives/goal';

/**
 * What the goal pages are handed: plain data, built on the server
 * (`app/.../dashboard/goals`), so the client never reads a goal itself.
 */

/** One row of a Goals list. */
export type GoalRow = {
  id: number;
  title: string;
  href: string;
  status: GoalStatus;
  /** "by Nov 30, 2026", "in Q4 2026". */
  horizon: string;
  /** "12 of 40", from the last reading; "not measured yet". */
  progress: string;
  ratio: number | null;
  owner: string;
  mine: boolean;
  /** Where it lives, when a list spans workspaces: "GTM · Northwind". */
  place?: string;
  /** Days without progress, when an active goal has gone quiet. */
  stalledDays?: number | null;
};

/** One goal, as its page draws it. */
export type GoalDetail = {
  id: number;
  title: string;
  status: GoalStatus;
  horizon: string;
  daysLeft: number;
  owner: string;
  isOwner: boolean;
  workspace: string;
  weeklyReview: boolean;
  progress: { label: string; ratio: number | null; unmeasured?: string };
  measure: { kind: 'view'; viewName: string; href: string | null } | { kind: 'milestones' } | { kind: 'sprint' };
  milestones: Array<{ key: string; label: string; done: boolean; doneAt?: string; by: 'agent' | 'person' | null; evidence?: string; locked: boolean; link?: { title: string; href: string } | null }>;
  /** A sprint's scorecard: the latest weeks up to this one, oldest first. */
  scorecard: GoalScorecard | null;
  links: Array<{ kind: string; id: string; title: string; href: string }>;
  nextSteps: NextStep[];
  /** Newest first. */
  activity: Array<{ at: string; what: string; by: string }>;
  stalledDays: number | null;
};

/** One logged number, as a cell draws it. */
export type ScorecardCell = { value: number | null; met: boolean | null; by: 'agent' | 'person' | null; evidence?: string };

/** A sprint's scorecard: rows are weekly targets, columns are weeks. */
export type GoalScorecard = {
  /** "Week 3 of 13". */
  week: number;
  weeks: number;
  /** Each column's Monday, oldest first, and how it reads ("Oct 26"). */
  columns: Array<{ week: string; label: string; current: boolean; note?: string }>;
  rows: Array<{ key: string; label: string; perWeek: number; unit?: string; cells: ScorecardCell[] }>;
};
