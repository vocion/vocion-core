/**
 * AN OBJECTIVE — what a conversation is in the middle of, said in one line.
 *
 * Founder, 2026-10-09, on a phone, mid "setup my software factory": "Does it
 * give or should I have context mid objective?" It did not: a walk said
 * "3 of 5", its summary "Connected 0 of 5", the dock "1 of 4", and none of
 * them said what the whole thing was, what was done, what was next, or how
 * to stop and come back.
 *
 * So a conversation can carry ONE objective (`conversation.objective`), and
 * while it runs the composer carries one quiet line above the dock:
 * "Setting up Software Factory · 2 of 3 · Stop". Tapping it lists the steps.
 * The steps and what is done are never stored here: they are read live from
 * what the plugin declares and what the workspace holds
 * (`services/plugins/setupState.ts`), so a reload, the drawer, another tab or
 * another device all say the same thing, and a step done anywhere else is
 * done here too. What the row keeps is only which objective, and whether the
 * person stopped it.
 *
 * Pure, so the strip, the opening hint and the tests read one answer.
 */

/** What the conversation row keeps (`conversation.objective`, migration 0201). */
export type ConversationObjective = {
  /** One kind today: setting up an app's plugin. A new kind is a new member here. */
  kind: 'setup';
  /** The plugin being set up (its slug). */
  plugin: string;
  /** `running` while it is under way; `stopped` when the person stopped it (Resume takes it back). */
  state: 'running' | 'stopped';
  startedAt: string;
  /** When the person stopped it, or resumed it. */
  changedAt?: string;
  /**
   * Optional extras an agent offered while setting it up that the plugin's
   * setup does not need (turning on Wiki, a Red team, another system): kept
   * here as "Later", never docked as steps (founder, 2026-10-09).
   */
  later?: LaterExtra[];
};

/** One optional extra, kept for after the objective. */
export type LaterExtra = { key: string; label: string };

/** One step, as the setup state names it. */
export type ObjectiveStep = { key: string; label: string; done: boolean };

/** What the strip draws. */
export type ObjectiveView = {
  conversationId: number;
  kind: ConversationObjective['kind'];
  plugin: string;
  /** "Software Factory". */
  name: string;
  state: ConversationObjective['state'] | 'done';
  steps: ObjectiveStep[];
  /** How many are done. */
  done: number;
  total: number;
  /** The step the person is on (0-based): the first not done; `total` when all are. */
  current: number;
  /** Optional extras for after it, never steps of it. */
  later: LaterExtra[];
};

/**
 * Whether a stored value is an objective this code can read: a row written
 * by a later release (a kind this one does not know) reads as none.
 * @param value - The column's value.
 */
export function readObjective(value: unknown): ConversationObjective | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const o = value as Partial<ConversationObjective>;
  if (o.kind !== 'setup' || typeof o.plugin !== 'string' || !o.plugin || (o.state !== 'running' && o.state !== 'stopped') || typeof o.startedAt !== 'string') {
    return null;
  }
  const later = Array.isArray(o.later) ? o.later.filter((x): x is LaterExtra => !!x && typeof x.key === 'string' && typeof x.label === 'string').slice(0, 12) : [];
  return { kind: 'setup', plugin: o.plugin, state: o.state, startedAt: o.startedAt, ...(typeof o.changedAt === 'string' ? { changedAt: o.changedAt } : {}), ...(later.length > 0 ? { later } : {}) };
}

/**
 * The objective as the person sees it now: the stored one, read against the
 * plugin's live setup steps.
 * @param conversationId - The conversation.
 * @param objective - What the row keeps.
 * @param setup - The plugin's setup now (`setupStateForOrg`), or null when it is no longer on.
 * @param setup.name - Its name.
 * @param setup.steps - Its steps.
 */
export function objectiveView(conversationId: number, objective: ConversationObjective, setup: { name: string; steps: ObjectiveStep[] } | null): ObjectiveView | null {
  if (!setup || setup.steps.length === 0) {
    return null;
  }
  const steps = setup.steps.map(s => ({ key: s.key, label: s.label, done: s.done }));
  const done = steps.filter(s => s.done).length;
  const first = steps.findIndex(s => !s.done);
  return {
    conversationId,
    kind: objective.kind,
    plugin: objective.plugin,
    name: setup.name,
    state: first === -1 ? 'done' : objective.state,
    steps,
    done,
    total: steps.length,
    current: first === -1 ? steps.length : first,
    later: objective.later ?? [],
  };
}

/**
 * The one line: "Setting up Software Factory · 2 of 3", "Paused setting up
 * Software Factory · 2 of 3", "Software Factory is set up".
 * @param view - The objective.
 */
export function progressLine(view: ObjectiveView): string {
  if (view.state === 'done') {
    return `${view.name} is set up`;
  }
  const where = `${Math.min(view.current + 1, view.total)} of ${view.total}`;
  return view.state === 'stopped' ? `Paused setting up ${view.name} · ${where}` : `Setting up ${view.name} · ${where}`;
}

/**
 * Keep optional extras for later, once each, newest last.
 * @param objective - The objective.
 * @param extras - What the agent offered that the setup does not need.
 */
export function withLater(objective: ConversationObjective, extras: LaterExtra[]): ConversationObjective {
  const have = new Set((objective.later ?? []).map(x => x.key));
  const added = extras.filter(x => !have.has(x.key) && (have.add(x.key), true));
  return added.length === 0 ? objective : { ...objective, later: [...(objective.later ?? []), ...added].slice(-12) };
}

/**
 * Which plugin a setup objective is about, when a turn reads the setup: the
 * one the agent named, if it is on and unfinished; else the only unfinished
 * one; else none — never a guess between two.
 * @param setups - Every plugin's setup now.
 * @param named - The plugin the agent said the person is setting up, if it said.
 */
export function setupObjectiveFor(setups: Array<{ plugin: string; complete: boolean }>, named?: string | null): string | null {
  const open = setups.filter(s => !s.complete);
  if (named) {
    return open.some(s => s.plugin === named) ? named : null;
  }
  return open.length === 1 ? open[0]!.plugin : null;
}
