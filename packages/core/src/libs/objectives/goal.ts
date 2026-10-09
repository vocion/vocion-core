/**
 * A GOAL — an objective a person owns past any one conversation.
 *
 * The objective noun (`objective.ts`) began as what one conversation is in
 * the middle of: setting up an app. A goal is the same noun with a longer
 * life — "Follow up with every Northwind Expo contact by November 30",
 * "Activate the referral partners this quarter" — so objectives gain a kind
 * (`setup` | `goal`) and a goal keeps a row of its own (`goal`, migration
 * 0209), owned by one person in one home workspace.
 *
 * A goal says how it is measured, one of two ways, and never by a tick:
 *
 * - **view** — a saved view (`services/state/state.ts`) plus what counts as
 *   done in it, or a target count: "12 of 40 contacted". Computed live from
 *   the index every time it is read.
 * - **milestones** — 3 to 7 steps the agent proposes. A step linked to work
 *   is done when that work is (a record closed, an artifact or wiki page
 *   written, a view emptied); the agent may mark one done with evidence; the
 *   person's own tick or untick always wins and is never undone by a check.
 *
 * Pure: the service, the agent's tools, the goal page, the brief and the
 * tests read one answer from here.
 */

/** The objective kinds. A setup is a conversation's; a goal is a person's. */
export const OBJECTIVE_KINDS = ['setup', 'goal'] as const;
export type ObjectiveKind = typeof OBJECTIVE_KINDS[number];

export const GOAL_STATUSES = ['active', 'paused', 'done', 'dropped'] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];

/** When a goal is for: a date, or a quarter. */
export type GoalHorizon = { kind: 'date'; due: string } | { kind: 'quarter'; quarter: string };

/** What a goal links to — the same kinds a person can pin. */
export const GOAL_LINK_KINDS = ['room', 'wiki', 'artifact', 'view', 'conversation', 'record'] as const;
export type GoalLinkKind = typeof GOAL_LINK_KINDS[number];
export type GoalLink = { kind: GoalLinkKind; id: string; label?: string };

export type Milestone = {
  key: string;
  label: string;
  done: boolean;
  doneAt?: string;
  /** Who marked it: `agent` (from linked work or with evidence), or the person's id. */
  by?: string;
  /** The work that completes it, when there is one. */
  link?: GoalLink;
  /** The agent's evidence when it marked it done. */
  evidence?: string;
  /** The person set it by hand: no check moves it again. */
  locked?: boolean;
};

/** Facet filter, as `query_state` takes it. */
export type FacetFilterLike = Record<string, unknown>;

export type GoalMeasure
  = | {
    kind: 'view';
    /** The saved view's slug. */
    view: string;
    /** The facets that make a row of the view count as done ("contacted"). */
    done?: FacetFilterLike;
    /** How many make it done; without `done`, the view's own count is measured against it. */
    target?: number;
    /** What a done row is called: "contacted". */
    unit?: string;
  }
  | { kind: 'milestones'; milestones: Milestone[] };

export const MIN_MILESTONES = 3;
export const MAX_MILESTONES = 7;

/** One line of "what moved". */
export type GoalActivity = { at: string; what: string; by: string };

/** A suggested next step: a prompt that starts a turn, never a card. */
export type NextStep = { label: string; prompt: string; why?: string };

export type Goal = {
  id: number;
  orgId: string;
  accountId: string;
  ownerUserId: string;
  title: string;
  horizon: GoalHorizon;
  status: GoalStatus;
  measure: GoalMeasure;
  links: GoalLink[];
  cadence: 'weekly' | null;
  nextSteps: NextStep[];
  activity: GoalActivity[];
  lastDone: number | null;
  lastTotal: number | null;
  progressAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Where a goal stands, said once for every surface. */
export type GoalProgress = {
  done: number;
  total: number;
  /** 0..1; null when there is nothing to measure against. */
  ratio: number | null;
  /** "12 of 40 contacted", "2 of 5 milestones". */
  label: string;
  /** Why it could not be measured, said rather than guessed. */
  unmeasured?: string;
};

/** How long without progress before a goal reads as stalled. */
export const STALL_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;
const QUARTER = /^(\d{4})-Q([1-4])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A horizon from what a person or agent wrote: `2026-11-30`, `2026-Q4`,
 * `Q4 2026`, `Q4` (this year, or next once it is past). Null when it is
 * neither.
 * @param text - What was written.
 * @param now - The clock, for a bare quarter.
 */
export function parseHorizon(text: string, now: Date = new Date()): GoalHorizon | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, ' ');
  if (DATE.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`))) {
    return { kind: 'date', due: t };
  }
  const iso = QUARTER.exec(t);
  if (iso) {
    return { kind: 'quarter', quarter: `${iso[1]}-Q${iso[2]}` };
  }
  const yearFirst = /^(\d{4}) Q([1-4])$/.exec(t);
  if (yearFirst) {
    return { kind: 'quarter', quarter: `${yearFirst[1]}-Q${yearFirst[2]}` };
  }
  const words = /^Q([1-4])(?: (\d{4}))?$/.exec(t);
  if (words) {
    const q = Number(words[1]);
    let year = words[2] ? Number(words[2]) : now.getUTCFullYear();
    if (!words[2] && quarterEnd({ kind: 'quarter', quarter: `${year}-Q${q}` }).getTime() < now.getTime()) {
      year += 1;
    }
    return { kind: 'quarter', quarter: `${year}-Q${q}` };
  }
  return null;
}

/**
 * The last moment of a quarter, or the end of a due date's day, in UTC.
 * @param h - The horizon.
 */
export function quarterEnd(h: GoalHorizon): Date {
  if (h.kind === 'date') {
    return new Date(`${h.due}T23:59:59Z`);
  }
  const m = QUARTER.exec(h.quarter);
  const year = m ? Number(m[1]) : 1970;
  const q = m ? Number(m[2]) : 1;
  return new Date(Date.UTC(year, q * 3, 1) - 1000);
}

/**
 * The horizon as a person reads it: "by Nov 30, 2026", "in Q4 2026".
 * @param h - The horizon.
 */
export function horizonLabel(h: GoalHorizon): string {
  if (h.kind === 'quarter') {
    const m = QUARTER.exec(h.quarter);
    return m ? `in Q${m[2]} ${m[1]}` : h.quarter;
  }
  const d = new Date(`${h.due}T12:00:00Z`);
  return `by ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
}

/**
 * Days left until the horizon (negative once past).
 * @param h - The horizon.
 * @param now - The clock.
 */
export function daysLeft(h: GoalHorizon, now: Date): number {
  return Math.ceil((quarterEnd(h).getTime() - now.getTime()) / DAY);
}

/**
 * Progress of a view measure from two counts read off the index.
 * @param measure - The view measure.
 * @param counts - What the view holds now.
 * @param counts.total - Rows in the view.
 * @param counts.done - Rows matching the done facets (ignored without them).
 */
export function viewProgress(measure: Extract<GoalMeasure, { kind: 'view' }>, counts: { total: number; done: number }): GoalProgress {
  const unit = measure.unit?.trim();
  if (measure.done && Object.keys(measure.done).length > 0) {
    const total = measure.target ?? counts.total;
    const done = Math.min(counts.done, total || counts.done);
    return { done, total, ratio: total > 0 ? done / total : null, label: `${done} of ${total}${unit ? ` ${unit}` : ''}` };
  }
  if (measure.target && measure.target > 0) {
    const done = Math.min(counts.total, measure.target);
    return { done, total: measure.target, ratio: done / measure.target, label: `${counts.total} of ${measure.target}${unit ? ` ${unit}` : ''}` };
  }
  return { done: 0, total: counts.total, ratio: null, label: `${counts.total} in the view`, unmeasured: 'The view has no done facets and no target, so there is nothing to measure it against.' };
}

/**
 * Progress of a milestone measure.
 * @param milestones - The milestones.
 */
export function milestoneProgress(milestones: readonly Milestone[]): GoalProgress {
  const done = milestones.filter(m => m.done).length;
  const total = milestones.length;
  return { done, total, ratio: total > 0 ? done / total : null, label: `${done} of ${total} ${total === 1 ? 'milestone' : 'milestones'}` };
}

/** What a piece of linked work says about itself, as the service read it. */
export type LinkState = 'complete' | 'open' | 'missing';

/**
 * The key a link is known by.
 * @param link - The link.
 */
export function linkKey(link: Pick<GoalLink, 'kind' | 'id'>): string {
  return `${link.kind}:${link.id}`;
}

/**
 * Milestones after linked work is read: a step whose work completed is done,
 * by the agent; one the person set by hand is left exactly as they set it.
 * A step is never un-done by a check: work that reopens is the person's call.
 * Returns the same array when nothing moved.
 * @param milestones - The milestones.
 * @param states - Each linked item's state, by {@link linkKey}.
 * @param now - The clock.
 */
export function completeFromLinks(milestones: Milestone[], states: ReadonlyMap<string, LinkState>, now: Date): Milestone[] {
  let moved = false;
  const next = milestones.map((m) => {
    if (m.done || m.locked || !m.link || states.get(linkKey(m.link)) !== 'complete') {
      return m;
    }
    moved = true;
    return { ...m, done: true, doneAt: now.toISOString(), by: 'agent', evidence: `Linked ${m.link.kind} completed.` };
  });
  return moved ? next : milestones;
}

/**
 * Mark one milestone done or not. The person's hand locks it; the agent's
 * mark needs evidence and never overrides the person's.
 * @param milestones - The milestones.
 * @param key - Which one.
 * @param done - Done or not.
 * @param by - `agent`, or the person's id.
 * @param now - The clock.
 * @param evidence - The agent's reason.
 * @returns The milestones, and whether anything changed (or why not).
 */
export function setMilestone(milestones: Milestone[], key: string, done: boolean, by: string, now: Date, evidence?: string): { milestones: Milestone[]; changed: boolean; refused?: string } {
  const at = milestones.findIndex(m => m.key === key);
  if (at === -1) {
    return { milestones, changed: false, refused: `No milestone "${key}". Milestones: ${milestones.map(m => m.key).join(', ')}.` };
  }
  const m = milestones[at]!;
  const agent = by === 'agent';
  if (agent && m.locked) {
    return { milestones, changed: false, refused: `The person set "${m.label}" themselves; leave it as they set it.` };
  }
  if (agent && done && !evidence?.trim()) {
    return { milestones, changed: false, refused: 'Say what shows it is done (evidence), so the person can check it.' };
  }
  if (m.done === done && (agent || m.locked)) {
    return { milestones, changed: false };
  }
  const next: Milestone = done
    ? { ...m, done: true, doneAt: now.toISOString(), by, ...(evidence ? { evidence: evidence.trim() } : {}), ...(agent ? {} : { locked: true }) }
    : { key: m.key, label: m.label, done: false, by, ...(m.link ? { link: m.link } : {}), ...(agent ? {} : { locked: true }) };
  const out = [...milestones];
  out[at] = next;
  return { milestones: out, changed: true };
}

/**
 * Milestones from labels the agent proposed: keyed `m1`…, 3 to 7 of them.
 * @param items - Labels, each with an optional link.
 */
export function milestonesFrom(items: ReadonlyArray<{ label: string; link?: GoalLink }>): Milestone[] {
  return items.map((m, i) => ({ key: `m${i + 1}`, label: m.label.trim(), done: false, ...(m.link ? { link: m.link } : {}) }));
}

/**
 * Why a measure cannot be kept, or null.
 * @param measure - The measure.
 */
export function measureProblem(measure: GoalMeasure): string | null {
  if (measure.kind === 'milestones') {
    const n = measure.milestones.length;
    if (n < MIN_MILESTONES || n > MAX_MILESTONES) {
      return `A goal measured by milestones has ${MIN_MILESTONES} to ${MAX_MILESTONES} of them; this has ${n}.`;
    }
    if (measure.milestones.some(m => !m.label.trim())) {
      return 'Every milestone needs a label.';
    }
    return null;
  }
  if (!measure.view.trim()) {
    return 'A view measure names a saved view.';
  }
  if (!measure.done && !measure.target) {
    return 'A view measure needs what counts as done in it (done facets) or a target count.';
  }
  if (measure.target !== undefined && (!Number.isInteger(measure.target) || measure.target < 1)) {
    return 'A target is a whole number above zero.';
  }
  return null;
}

/**
 * Whether an active goal has gone quiet: no progress for {@link STALL_DAYS}
 * (or since it was made, when it never moved).
 * @param goal - The goal.
 * @param goal.status - Its status.
 * @param goal.progressAt - When it last moved.
 * @param goal.createdAt - When it was made.
 * @param now - The clock.
 * @param days - The threshold.
 * @returns Days since it moved, or null when it is not stalled.
 */
export function stalledFor(goal: Pick<Goal, 'status' | 'progressAt' | 'createdAt'>, now: Date, days: number = STALL_DAYS): number | null {
  if (goal.status !== 'active') {
    return null;
  }
  const since = goal.progressAt ?? goal.createdAt;
  const quiet = Math.floor((now.getTime() - since.getTime()) / DAY);
  return quiet >= days ? quiet : null;
}

/**
 * Up to three next steps, as prompts the person can send: the agent's own
 * when it wrote some, else derived from where the goal stands. Pure.
 * @param goal - The goal.
 * @param goal.title - Its title.
 * @param goal.measure - Its measure.
 * @param goal.nextSteps - What the agent proposed.
 * @param goal.status - Its status.
 * @param progress - Where it stands.
 * @param viewName - The view's name, for a view measure.
 */
export function nextStepsFor(goal: Pick<Goal, 'title' | 'measure' | 'nextSteps' | 'status'>, progress: GoalProgress, viewName?: string): NextStep[] {
  if (goal.status === 'done' || goal.status === 'dropped') {
    return [];
  }
  if (goal.nextSteps.length > 0) {
    return goal.nextSteps.slice(0, 3);
  }
  const out: NextStep[] = [];
  if (goal.measure.kind === 'milestones') {
    const open = goal.measure.milestones.filter(m => !m.done);
    for (const m of open.slice(0, 2)) {
      out.push({ label: `Work on “${m.label}”`, prompt: `For my goal "${goal.title}": help me with the next milestone, "${m.label}".` });
    }
  } else {
    const left = Math.max(progress.total - progress.done, 0);
    const what = viewName ? `“${viewName}”` : 'the view';
    if (left > 0) {
      out.push({ label: `Take the next ${Math.min(left, 5)} in ${what}`, prompt: `For my goal "${goal.title}": show me the next ${Math.min(left, 5)} in ${what} that are not done yet, and draft what I should send.` });
    }
  }
  out.push({ label: 'What is in the way?', prompt: `For my goal "${goal.title}": what is in the way, and what would move it most this week?` });
  return out.slice(0, 3);
}

/**
 * The goal in one line: "Follow up with Northwind Expo contacts · 12 of 40 contacted · by Nov 30, 2026".
 * @param goal - The goal.
 * @param goal.title - Its title.
 * @param goal.horizon - Its horizon.
 * @param goal.status - Its status.
 * @param progress - Where it stands.
 */
export function goalLine(goal: Pick<Goal, 'title' | 'horizon' | 'status'>, progress: GoalProgress): string {
  const state = goal.status === 'active' ? '' : ` · ${goal.status}`;
  return `${goal.title} · ${progress.label} · ${horizonLabel(goal.horizon)}${state}`;
}

/**
 * Keep the newest activity lines, capped.
 * @param activity - What is there.
 * @param line - What moved.
 */
export function withActivity(activity: readonly GoalActivity[], line: GoalActivity): GoalActivity[] {
  return [...activity, line].slice(-50);
}

/**
 * What a stored value reads as, or null for anything this code cannot read.
 * @param value - A `horizon` column value.
 */
export function readHorizon(value: unknown): GoalHorizon | null {
  const h = value as Partial<GoalHorizon> | null;
  if (h?.kind === 'date' && typeof h.due === 'string' && DATE.test(h.due)) {
    return { kind: 'date', due: h.due };
  }
  if (h?.kind === 'quarter' && typeof h.quarter === 'string' && QUARTER.test(h.quarter)) {
    return { kind: 'quarter', quarter: h.quarter };
  }
  return null;
}

/**
 * What pinning a goal points at: the object-pin shape on `feat/pin-favorites`
 * (`libs/pins/pinTarget.ts`, `{ kind, id }` stored as `pin:goal:<id>`). The
 * hook for when that lands: add `goal` to its PIN_KINDS and its resolver
 * reads `getGoal`; the goal page already carries this target.
 * @param id - The goal.
 */
export function goalPinTarget(id: number): { kind: 'goal'; id: string } {
  return { kind: 'goal', id: String(id) };
}
