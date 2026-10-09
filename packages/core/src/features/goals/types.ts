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
  measure: { kind: 'view'; viewName: string; href: string | null } | { kind: 'milestones' };
  milestones: Array<{ key: string; label: string; done: boolean; doneAt?: string; by: 'agent' | 'person' | null; evidence?: string; locked: boolean; link?: { title: string; href: string } | null }>;
  links: Array<{ kind: string; id: string; title: string; href: string }>;
  nextSteps: NextStep[];
  /** Newest first. */
  activity: Array<{ at: string; what: string; by: string }>;
  stalledDays: number | null;
};
