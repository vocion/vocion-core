/**
 * The self-improvement class — which action kinds are the system changing
 * ITSELF rather than changing the world.
 *
 * Chris, 2026-09-18: *"tune the app so that it's eager to learn and self
 * update knowledge base, prompts, memory, missions, playbooks, wikis."*
 * Before this, exactly one self-update rode the autonomy ladder
 * (`wiki.write_page`) and everything else an agent learned about itself was
 * either a bare service call with no receipt (mission working notes, memory
 * rules) or impossible (playbooks, system prompts). The eagerness is not a
 * new mechanism: it is more nouns in the mechanism that already exists —
 * propose with a confidence, execute above the bar, show it where it
 * happened, and put it back in one click.
 *
 * **Membership costs an `undo`.** A kind is in this class only if
 * `execute` records enough to restore exactly what was there — the previous
 * artifact version, the previous notes, the previous prompt text. That is the
 * price of the autonomy: nothing here is allowed to be a change a person
 * cannot take back from where they read about it. `selfUpdate.test.ts` holds
 * the registry to it.
 *
 * **One dial, not a second one.** `defaults.learningEagerness`
 * (`libs/actions/eagerness.ts`) owns the confidence bar for every member of
 * this class that only changes what the system KNOWS. An action opts in by
 * declaring `selfImproving`, and `decideExecution` reads the dial on the
 * default branch; this table records which members are on it, and a test
 * holds the two together. Nothing here supplies a number of its own.
 *
 * Pure: no database, no registry, no React. The service, the trust ladder,
 * the chat chip, the Activity event and the tests all read the same table.
 */

/** The six things the system changes about itself. One word each, because the chip has one line. */
export const SELF_UPDATE_NOUNS = ['wiki', 'memory', 'playbook', 'mission', 'prompt', 'capability', 'teammate'] as const;

export type SelfUpdateNoun = typeof SELF_UPDATE_NOUNS[number];

/**
 * Risk, in the autonomy ladder's vocabulary. Declared as a literal union
 * rather than imported from `services/autonomy/rungs` because that module
 * reads THIS one for its defaults; a value import back would be a cycle.
 */
export type SelfUpdateRisk = 'low' | 'medium' | 'high';

export type SelfUpdateKind = {
  /** Registered action id. */
  actionId: string;
  noun: SelfUpdateNoun;
  /** The verb phrase the chip and the Activity row lead with. Present tense, the system as subject. */
  verb: string;
  /** How much a mistake costs — the tier the ladder promotes against. */
  risk: SelfUpdateRisk;
  /**
   * The kind is on the workspace's learning dial: its action declares
   * `selfImproving`, so the confidence it must clear comes from
   * `defaults.learningEagerness` rather than the platform's flat 0.8.
   *
   * False for a member whose blast radius is wider than "an agent reads a
   * sentence nobody meant" — those keep the platform default, or ask.
   */
  onTheDial: boolean;
  /** One clause for why this kind stands where it does — read on the autonomy page and in review. */
  why: string;
};

/**
 * The class. Everything here is reversible and internal, and the order is
 * the order a person meets them: the cheapest first, the sharpest last.
 *
 * `learning.adopt_rule` is defined in `learning-adopt-rule.ts` and owned by
 * the change that shipped the dial; this row classifies it, so the chip, the
 * Activity event and the "what has it taught itself" filter cover it without
 * a second definition of the action anywhere.
 */
export const SELF_UPDATE_KINDS: readonly SelfUpdateKind[] = [
  {
    actionId: 'wiki.write_page',
    noun: 'wiki',
    verb: 'Updated the wiki',
    risk: 'low',
    onTheDial: true,
    why: 'a page edit is one version away from the previous one, and it only changes what the system knows',
  },
  {
    actionId: 'mission.update_notes',
    noun: 'mission',
    verb: 'Updated mission notes',
    risk: 'low',
    onTheDial: true,
    why: 'the notes are the mission\'s own memory of its last check, and the previous text is kept',
  },
  {
    actionId: 'learning.adopt_rule',
    noun: 'memory',
    verb: 'Remembered a rule',
    risk: 'low',
    onTheDial: true,
    why: 'a rule is removed with one click and the agent reads the store fresh on the next turn',
  },
  {
    actionId: 'playbook.write',
    noun: 'playbook',
    verb: 'Revised a playbook',
    risk: 'low',
    onTheDial: true,
    why: 'the whole previous file is kept on the run, so undo is a byte-for-byte restore',
  },
  {
    actionId: 'plugin.enable',
    noun: 'capability',
    verb: 'Turned on a capability',
    risk: 'low',
    onTheDial: false,
    why: 'turning a plugin on changes what the system can DO — it adds agents, pages and automations — so it keeps the platform\'s flat bar rather than riding a dial meant for what the system knows',
  },
  {
    actionId: 'team.hire_agent',
    noun: 'teammate',
    verb: 'Hired a teammate',
    risk: 'medium',
    onTheDial: false,
    why: 'hiring adds a standing teammate that takes turns, spends its allowance and acts under the workspace\'s name — a wider blast radius than a sentence nobody meant, so it keeps a tier of its own rather than riding the learning dial, and medium means the ladder never offers it autonomy',
  },
  {
    actionId: 'agent.revise_prompt',
    noun: 'prompt',
    verb: 'Revised its own instructions',
    risk: 'medium',
    onTheDial: false,
    why: 'an agent editing its own instructions changes every turn that follows, so it is the class\'s only medium tier: the default branch is never reached, a person decides, and the diff is on the card',
  },
];

const BY_ID: ReadonlyMap<string, SelfUpdateKind> = new Map(SELF_UPDATE_KINDS.map(k => [k.actionId, k]));

/** The class as a set, for a filter or an `IN (…)`. */
export const SELF_UPDATE_ACTION_IDS: readonly string[] = SELF_UPDATE_KINDS.map(k => k.actionId);

/**
 * The class member for an action id, or undefined when the kind changes the
 * world rather than the system.
 * @param actionId - A registered action id.
 */
export function selfUpdateKind(actionId: string): SelfUpdateKind | undefined {
  return BY_ID.get(actionId);
}

/**
 * Whether this action kind is the system improving itself.
 * @param actionId - A registered action id.
 */
export function isSelfUpdate(actionId: string): boolean {
  return BY_ID.has(actionId);
}

/**
 * Risk tiers for the class, spread into `DEFAULT_RISK_TIER` so the ladder,
 * the autonomy page and the tests read one table.
 */
export const SELF_UPDATE_RISK: Readonly<Record<string, SelfUpdateRisk>>
  = Object.fromEntries(SELF_UPDATE_KINDS.map(k => [k.actionId, k.risk]));

/**
 * The members whose bar comes from `defaults.learningEagerness`. Their
 * actions declare `selfImproving`; this is the same fact written where the
 * class is read, and `selfUpdate.test.ts` fails if the two ever disagree.
 */
export const SELF_UPDATE_ON_THE_DIAL: readonly string[]
  = SELF_UPDATE_KINDS.filter(k => k.onTheDial).map(k => k.actionId);

/**
 * The verb each noun is spoken with, keyed by noun rather than by action id
 * so a second kind that touches the same noun reads identically. Derived from
 * the table above, so the table stays the one place a wording is changed.
 */
export const NOUN_VERB: Readonly<Record<SelfUpdateNoun, string>> = Object.fromEntries(
  SELF_UPDATE_NOUNS.map(n => [n, SELF_UPDATE_KINDS.find(k => k.noun === n)?.verb ?? 'Updated itself']),
) as Record<SelfUpdateNoun, string>;

/* ------------------------------------------------------------------ */
/* What a self-update says, wherever it is shown                       */
/* ------------------------------------------------------------------ */

/**
 * One self-update, as every surface reads it: the chat chip, the Activity
 * row, the toast after a review decision.
 */
export type SelfUpdateReceipt = {
  /** The `action_run` — what Undo is called with. */
  runId: number;
  noun: SelfUpdateNoun;
  /** The thing it touched, named for a person: a page title, a mission, an agent. */
  target: string;
  /** How much moved — `v3`, `+12 −4 lines`, `2 rules`. Omitted when the change has no size worth saying. */
  change?: string;
  /** `applied` ran on its own and is undoable; `proposed` was under the bar and is waiting on a person. */
  status: 'applied' | 'proposed';
  /** The thing itself, one click away. */
  href?: string;
};

/**
 * The one line a self-update reads as. Same sentence in the transcript, in
 * Activity and in a toast, so nobody has to learn two vocabularies.
 * @param r - The receipt.
 */
export function selfUpdateLine(r: SelfUpdateReceipt): string {
  const head = `${NOUN_VERB[r.noun]} · ${r.target}`;
  const sized = r.change ? `${head} · ${r.change}` : head;
  return r.status === 'proposed' ? `${sized} — waiting on you` : sized;
}

/**
 * What a group of self-updates from one turn reads as on its single chip.
 * One update keeps its own sentence; several collapse into a count, because
 * three chips stacked under a turn is the thing this was built not to be.
 * @param rs - Every self-update from one turn, in the order they happened.
 */
export function selfUpdateGroupLabel(rs: readonly SelfUpdateReceipt[]): string {
  if (rs.length === 0) {
    return '';
  }
  if (rs.length === 1) {
    return selfUpdateLine(rs[0]!);
  }
  const waiting = rs.filter(r => r.status === 'proposed').length;
  const head = `Taught itself ${rs.length} things`;
  return waiting > 0 ? `${head} · ${waiting} waiting on you` : head;
}

/**
 * Fold one self-update into a turn's list. Keyed by run id so a kind that
 * refreshes its own proposal (the dedup path) leaves one entry at its latest
 * state rather than a row per attempt — the same rule the artifact chip uses.
 * @param existing - What the turn has so far.
 * @param next - The update that just arrived.
 */
export function mergeSelfUpdate(existing: readonly SelfUpdateReceipt[], next: SelfUpdateReceipt): SelfUpdateReceipt[] {
  return [...existing.filter(r => r.runId !== next.runId), next];
}

/* ------------------------------------------------------------------ */
/* The diff a prompt change is read with                               */
/* ------------------------------------------------------------------ */

export type LineDiff = {
  added: number;
  removed: number;
  /** `+12 −4 lines`, or `no lines changed` when only whitespace moved. */
  summary: string;
  /** The changed lines themselves, `+`/`−` prefixed, capped — the receipt a person actually reads. */
  preview: string[];
};

const DIFF_PREVIEW_LINES = 12;

/**
 * A line-level diff of two documents, as a count and a capped preview.
 *
 * Multiset difference rather than a longest-common-subsequence: it is exact
 * about WHICH lines are new and which are gone, which is the question a
 * person reads a prompt diff to answer, and it never mis-reports a pure move
 * as a rewrite. It does not produce hunks, and does not pretend to.
 * @param before - The document as it was. Empty string for a new file.
 * @param after - The document as it will be.
 */
export function diffLines(before: string, after: string): LineDiff {
  const norm = (s: string) => s.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
  const a = norm(before);
  const b = norm(after);
  const tally = (xs: readonly string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) {
      m.set(x, (m.get(x) ?? 0) + 1);
    }
    return m;
  };
  const ca = tally(a);
  const cb = tally(b);
  /**
   * The lines of `xs` that `other` does not also have, in the order they appear.
   * @param xs
   * @param mine
   * @param other
   */
  const surplus = (xs: readonly string[], mine: Map<string, number>, other: Map<string, number>) => {
    const budget = new Map<string, number>();
    for (const [line, n] of mine) {
      budget.set(line, Math.max(0, n - (other.get(line) ?? 0)));
    }
    const out: string[] = [];
    for (const line of xs) {
      const left = budget.get(line) ?? 0;
      if (left > 0) {
        out.push(line);
        budget.set(line, left - 1);
      }
    }
    return out;
  };
  const removed = surplus(a, ca, cb);
  const added = surplus(b, cb, ca);
  const summary = added.length === 0 && removed.length === 0
    ? 'no lines changed'
    : `+${added.length} \u2212${removed.length} lines`;
  const preview = [
    ...removed.slice(0, DIFF_PREVIEW_LINES).map(l => `\u2212 ${l}`),
    ...added.slice(0, DIFF_PREVIEW_LINES).map(l => `+ ${l}`),
  ];
  return { added: added.length, removed: removed.length, summary, preview };
}

/* ------------------------------------------------------------------ */
/* One run → one receipt                                               */
/* ------------------------------------------------------------------ */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim().length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The receipt for one self-update run, read off its input and result.
 *
 * One function so the chat chip, the Activity event and the review toast all
 * say the same words about the same run — the alternative is three places
 * that drift, which is the defect principle 6 names. Pure: hand it what the
 * run already stores.
 * @param run - The action run.
 * @param run.actionId - Registered action id; anything outside the class returns null.
 * @param run.runId - The `action_run` id, which is what Undo is called with.
 * @param run.status - Whether it ran or is waiting on a person.
 * @param run.input - The action's validated input.
 * @param run.result - What `execute` returned, when it has run.
 */
export function selfUpdateReceipt(run: {
  actionId: string;
  runId: number;
  status: 'applied' | 'proposed';
  input?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
}): SelfUpdateReceipt | null {
  const kind = selfUpdateKind(run.actionId);
  if (!kind) {
    return null;
  }
  const input = run.input ?? {};
  const result = run.result ?? {};
  const base = { runId: run.runId, noun: kind.noun, status: run.status, href: str(result.href) };
  switch (run.actionId) {
    case 'wiki.write_page':
      return {
        ...base,
        target: str(input.title) ?? str(input.slug) ?? 'a page',
        change: result.created === true ? 'created' : num(result.version) ? `v${num(result.version)}` : undefined,
      };
    case 'mission.update_notes':
      return { ...base, target: str(result.missionName) ?? str(input.slug) ?? 'a mission', change: str(result.change) };
    case 'playbook.write':
      return { ...base, target: str(input.name) ?? str(input.slug) ?? 'a playbook', change: str(result.change) };
    case 'agent.revise_prompt':
      return { ...base, target: str(result.agentName) ?? str(input.slug) ?? 'an agent', change: str(result.change) };
    case 'plugin.enable':
      return { ...base, target: str(input.slug) ?? 'a plugin', change: input.enabled === false ? 'off' : 'on' };
    case 'learning.adopt_rule': {
      // Restating a rule already on file adopts NOTHING — `recordProposedRule`
      // raises an occurrence count and stops. A chip or an Activity row for
      // that would claim the system learned something it did not, so there is
      // no receipt for it.
      const outcome = str(result.outcome);
      if (run.status === 'applied' && outcome !== undefined && outcome !== 'adopted') {
        return null;
      }
      const rule = str(input.ruleText) ?? 'a rule';
      return { ...base, target: rule.length > 70 ? `${rule.slice(0, 69)}…` : rule, change: str(result.stepName) ?? str(input.stepName) };
    }
    default:
      return { ...base, target: str(input.step) ?? str(input.stepName) ?? str(input.slug) ?? 'a rule', change: str(result.change) };
  }
}

/**
 * The counts the Activity event carries for a self-update, when the kind has
 * a size worth counting. Kept beside the receipt so one run produces one
 * description everywhere.
 * @param result - What `execute` returned.
 */
export function selfUpdateLineCounts(result: Record<string, unknown> | null | undefined): { linesAdded?: number; linesRemoved?: number } {
  const added = num(result?.linesAdded);
  const removed = num(result?.linesRemoved);
  return { ...(added === undefined ? {} : { linesAdded: added }), ...(removed === undefined ? {} : { linesRemoved: removed }) };
}

/**
 * Everything the system has taught itself, in one move, each with Undo.
 *
 * The Review queue's Decided tab already lists auto-executed runs with an
 * Undo on each, so the "what did it teach itself" surface is that list
 * filtered to this class — not a second history page beside it (principle 6:
 * two surfaces doing the same job is a defect; principle 7: do not implement
 * a history list twice).
 * @param tab - `decided` for what already ran, `open` for what is waiting.
 */
export function selfUpdateQueueHref(tab: 'decided' | 'open' = 'decided'): string {
  return `/dashboard/inbox?tab=${tab}&kind=proposal&actionKind=${SELF_UPDATE_ACTION_IDS.join(',')}`;
}
