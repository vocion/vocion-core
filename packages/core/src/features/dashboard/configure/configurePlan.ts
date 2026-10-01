import type { ConfigureAsideKind, ConfigureBlocks, ConfigureTabKind } from '@/libs/workspace/pageFields';
import { measureValue } from '@/features/dashboard/team-report/format';
import { pausedSince } from '@/libs/factory/delivery';
import { ageLabel } from '@/libs/timeAgo';
import { CONFIGURE_ASIDE_KINDS, CONFIGURE_TAB_KINDS } from '@/libs/workspace/pageFields';

/**
 * The Configure page's view model — pure, so what the page says is testable
 * without a database (`configurePlan.test.ts`).
 *
 * The page answers one question: what drives this plugin, and is any of it
 * asking for me? A main block of tabs, one relation of the plugin each, and a
 * sidebar of three blocks: how it is doing, what needs attention, what
 * changed. Every tab is a hairline list and every row is a door — to the
 * agent (in the preview pane), the skill, the automation, the ladder, the
 * learnings, the team report.
 *
 * Nothing here names a plugin, an agent, an action or a type: the inputs are
 * the plugin's own contents joined with the rows core already keeps, read by
 * `services/plugins/configureData.ts`. Another plugin's Configure page is its
 * page descriptor and nothing else (principles 6, 7, 12).
 */

/** A tone a chip is drawn in — mapped to the one pill by `toneToStatus`. */
export type ConfigureTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

/** One seat: an agent the plugin ships, as the workspace runs it. */
export type ConfigureSeatInput = {
  slug: string;
  name: string;
  /** The seat, in the plugin's words (`eyebrow`: "Software factory · QA"). */
  seat: string | null;
  /** `lead` or `specialist`. */
  role: string;
  model: string | null;
  /** The missions it owns, by name. */
  owns: string[];
  /** The newest thing it did — a tool call, a worker run, a mission it led. */
  lastRunAt: Date | null;
  /** Set when its budget refuses new runs this period. */
  overBudget: { spentCents: number; limitCents: number | null } | null;
};

/** One skill or playbook the plugin ships, and whether the workspace replaced it. */
export type ConfigureSkillInput = {
  slug: string;
  name: string;
  kind: 'skill' | 'playbook';
  /** `plugin` as shipped; `override` a workspace copy replacing it; `missing` never applied. */
  source: 'plugin' | 'override' | 'missing';
  updatedAt: Date | null;
  /** An override whose plugin copy changed after the override was last edited. */
  drifted: boolean;
};

/** One automation the plugin ships. */
export type ConfigureAutomationInput = {
  slug: string;
  name: string;
  /** "Every hour (UTC)", "On object.created". */
  trigger: string;
  /** What it does, in the author's words, or its target when they wrote none. */
  does: string;
  disabled: boolean;
  paused: { by: string | null; at: Date; note: string | null } | null;
  /** Its newest fire — including one that matched and could not start. */
  last: { at: Date; status: 'ok' | 'error' | 'running'; error: string | null; failedToStart: boolean } | null;
};

/** One rung of the plugin's trust ladder, as it stands in this workspace. */
export type ConfigureTrustInput = {
  key: string;
  /** The action's name from the registry, with the class a derived key narrows it to ("Merge a branch · docs"); the key when it has none. */
  name: string;
  /** Set on a derived key (`git.merge.docs`) — the rule it refines. */
  parent: string | null;
  /** Whether a proposal above the bar executes with no one asked. */
  runsOnItsOwn: boolean;
  rungLabel: string;
  minConfidence: number;
  risk: string;
  /** Demoted automatically and not yet looked at. */
  flagged: boolean;
};

/** A rule the plugin's agents follow now, or one waiting to be decided. */
export type ConfigureLearningInput = {
  id: string;
  text: string;
  status: string;
  at: Date | null;
  step: string;
  origin: string | null;
};

/** One measure, read exactly as the team report reads it. */
export type ConfigureMeasureInput = {
  id: string;
  label: string;
  teamName: string;
  unit: string | undefined;
  target: number;
  direction: 'higher' | 'lower';
  window: '24h' | '7d' | '30d' | 'quarter';
  value: number | null;
  previous: number | null;
  /** Whether the change since the prior window is the good direction. */
  improving: boolean | null;
  sourceLabel: string;
};

/** One configuration change: what, who, when, and where to see it. */
export type ConfigureChangeInput = {
  id: string;
  what: string;
  who: string | null;
  at: Date;
  href: string;
};

export type ConfigureInput = {
  pluginName: string;
  seats: ConfigureSeatInput[];
  skills: ConfigureSkillInput[];
  automations: ConfigureAutomationInput[];
  trust: ConfigureTrustInput[];
  learnings: ConfigureLearningInput[];
  measures: ConfigureMeasureInput[];
  changes: ConfigureChangeInput[];
};

/** A row, in the one shape every tab draws through `ListRow`. */
export type ConfigureRow = {
  id: string;
  title: string;
  /** Facts under the title, joined with `·`. Empty facts are dropped. */
  facts: string[];
  /** One right-aligned figure: a time, a value. */
  figure: string | null;
  chip: { label: string; tone: ConfigureTone } | null;
  href: string;
  /** Opens in the preview pane on a plain click; the row stays a link. */
  preview: { type: 'agent'; id: string } | null;
  /** A paused automation's Resume control: who paused it, when, and why, already in words. */
  resume?: { slug: string; byName: string; when: string; note: string | null } | null;
};

export type ConfigureTab = {
  key: ConfigureTabKind;
  label: string;
  count: number;
  /** One line of the exceptional state — "2 paused · 1 failing". Null when there is none. */
  note: string | null;
  rows: ConfigureRow[];
  /** What an empty tab says, in one line. */
  empty: string;
};

/** A measure as the sidebar reads it: value, direction, and the change. */
export type ConfigureHealthItem = {
  id: string;
  label: string;
  value: string;
  target: string;
  /** "↑ 38% vs last week". Null when there is no prior window to compare. */
  change: { label: string; tone: ConfigureTone } | null;
};

export type ConfigureLink = { id: string; label: string; href: string };

/** Something that needs a person: what it is, and what is wrong with it. */
export type ConfigureAttention = ConfigureLink & { detail: string };

export type ConfigureAside
  = | { kind: 'health'; label: string; items: ConfigureHealthItem[]; href: string }
    | { kind: 'attention'; label: string; items: ConfigureAttention[] }
    | { kind: 'changes'; label: string; items: Array<ConfigureLink & { who: string | null; when: string }> };

export type ConfigureView = {
  tabs: ConfigureTab[];
  /** The tab in force: `?tab=` when it names one, else the first. */
  active: ConfigureTabKind;
  aside: ConfigureAside[];
};

const TAB_LABEL: Record<ConfigureTabKind, string> = {
  seats: 'Seats',
  skills: 'Skills & playbooks',
  automations: 'Automations',
  trust: 'Trust rules',
  learned: 'Learned',
  measures: 'Measures',
};

const ASIDE_LABEL: Record<ConfigureAsideKind, string> = {
  health: 'How it\'s doing',
  attention: 'Needs attention',
  changes: 'Recently changed',
};

/** Where the full reading of each relation lives. */
const LEARNINGS_HREF = '/dashboard/learnings';
const AUTONOMY_HREF = '/dashboard/autonomy';
const TEAM_REPORT_HREF = '/dashboard/team-report';

/** How many changes the sidebar lists. */
const CHANGES_SHOWN = 6;

/** How much of a rule a row carries. */
const RULE_MAX = 140;

/**
 * The tab a URL asks for, when the page shows it; the first tab otherwise.
 * @param tabs - The tabs the page declared, in order.
 * @param asked - `?tab=`.
 */
export function chosenTab(tabs: readonly ConfigureTabKind[], asked: string | string[] | undefined): ConfigureTabKind {
  const one = Array.isArray(asked) ? asked[0] : asked;
  return tabs.find(t => t === one) ?? tabs[0] ?? CONFIGURE_TAB_KINDS[0];
}

/**
 * "vs last week" for a 7-day window, and so on.
 * @param window - The measure's window.
 */
function priorPhrase(window: ConfigureMeasureInput['window']): string {
  switch (window) {
    case '24h': return 'vs yesterday';
    case '7d': return 'vs last week';
    case '30d': return 'vs prior 30 days';
    case 'quarter': return 'vs last quarter';
  }
}

/**
 * The change since the prior window, as the one chip a metric carries: its
 * direction, its size, and whether that is good. Coloured only where the
 * measure says which way is better — arithmetic cannot tell a falling cost
 * from a falling quality.
 * @param m - The measure.
 */
export function measureChange(m: ConfigureMeasureInput): { label: string; tone: ConfigureTone } | null {
  if (m.value === null || m.previous === null) {
    return null;
  }
  const delta = m.value - m.previous;
  if (delta === 0) {
    return { label: `= ${priorPhrase(m.window).replace(/^vs /, '')}`, tone: 'muted' };
  }
  const arrow = delta > 0 ? '↑' : '↓';
  const size = m.previous !== 0
    ? `${Math.abs(Math.round((delta / Math.abs(m.previous)) * 100))}%`
    : measureValue(Math.abs(delta), m.unit);
  const tone: ConfigureTone = m.improving === null ? 'muted' : m.improving ? 'ok' : 'bad';
  return { label: `${arrow} ${size} ${priorPhrase(m.window)}`, tone };
}

function targetLine(m: ConfigureMeasureInput): string {
  return `target ${m.direction === 'lower' ? '≤' : '≥'} ${measureValue(m.target, m.unit)}`;
}

function valueLine(m: ConfigureMeasureInput): string {
  return m.value === null ? '—' : measureValue(m.value, m.unit);
}

function cut(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= RULE_MAX) {
    return clean;
  }
  const head = clean.slice(0, RULE_MAX);
  const space = head.lastIndexOf(' ');
  return `${(space > RULE_MAX * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function note(parts: Array<string | null>): string | null {
  const kept = parts.filter((p): p is string => p !== null);
  return kept.length > 0 ? kept.join(' · ') : null;
}

/**
 * The seat as a row says it: the plugin's own name is the page's, so an
 * eyebrow that opens with it ("Software factory · QA") reads as "QA", and a
 * seat that only repeats the agent's name says nothing.
 * @param seat - The agent's eyebrow.
 * @param pluginName - The plugin the page configures.
 * @param name - The agent's name.
 */
function seatLabel(seat: string | null, pluginName: string, name: string): string {
  if (!seat) {
    return '';
  }
  const prefix = `${pluginName} · `;
  const own = seat.startsWith(prefix) ? seat.slice(prefix.length) : seat;
  return own.toLowerCase() === name.toLowerCase() ? '' : own;
}

function seatRows(input: ConfigureInput, now: number): ConfigureRow[] {
  // A role every seat shares tells a person nothing; it is a fact only
  // where the seats differ.
  const roles = new Set(input.seats.map(s => s.role));
  return input.seats.map(s => ({
    id: s.slug,
    title: s.name,
    facts: [
      seatLabel(s.seat, input.pluginName, s.name),
      roles.size > 1 && s.role === 'lead' ? 'Lead' : '',
      s.model ?? '',
      s.owns.length > 0 ? `Owns ${s.owns.join(', ')}` : '',
    ],
    figure: s.lastRunAt ? ageLabel(s.lastRunAt, now) : null,
    chip: s.overBudget ? { label: 'Over budget', tone: 'bad' } : null,
    href: `/dashboard/agents/${s.slug}`,
    preview: { type: 'agent', id: s.slug },
  }));
}

function skillRows(input: ConfigureInput, now: number): ConfigureRow[] {
  return input.skills.map(s => ({
    id: `${s.kind}:${s.slug}`,
    title: s.name,
    facts: [s.kind === 'skill' ? 'Skill' : 'Playbook', s.slug],
    figure: s.updatedAt && s.source === 'override' ? ageLabel(s.updatedAt, now) : null,
    chip: s.source === 'override'
      ? (s.drifted ? { label: 'Override · behind plugin', tone: 'warn' } : { label: 'Workspace override', tone: 'info' })
      : s.source === 'missing'
        ? { label: 'Not applied', tone: 'warn' }
        // As shipped is the ordinary case; only a departure from it is marked.
        : null,
    href: `/dashboard/skills/${s.slug}`,
    preview: null,
  }));
}

function automationChip(a: ConfigureAutomationInput): ConfigureRow['chip'] {
  // A chip only where something is out of the ordinary: twenty grey "OK"s
  // and "Never fired"s bury the one that failed.
  if (a.paused) {
    return { label: 'Paused', tone: 'warn' };
  }
  if (a.disabled) {
    return { label: 'Off', tone: 'muted' };
  }
  if (a.last?.status === 'error') {
    return { label: a.last.failedToStart ? 'Failed to start' : 'Errored', tone: 'bad' };
  }
  if (a.last?.status === 'running') {
    return { label: 'Running', tone: 'info' };
  }
  return null;
}

function automationRows(input: ConfigureInput, now: number): ConfigureRow[] {
  return input.automations.map(a => ({
    id: a.slug,
    title: a.name,
    facts: [
      a.trigger,
      a.last?.status === 'error' && a.last.error ? a.last.error.split('\n')[0]!.slice(0, 160) : a.does,
      // WHO, WHEN AND WHY, on the row (2026-10-01, #294: a pause from ten days
      // before read only "Paused", and nothing it would have done was seen).
      a.paused ? `paused${a.paused.by ? ` by ${a.paused.by}` : ''} since ${pausedSince(a.paused.at.toISOString())}${a.paused.note ? `: ${a.paused.note}` : ''}` : '',
    ],
    figure: a.last ? ageLabel(a.last.at, now) : 'Never fired',
    chip: automationChip(a),
    href: `/dashboard/automation/${a.slug}`,
    preview: null,
    resume: a.paused ? { slug: a.slug, byName: a.paused.by ?? 'someone', when: pausedSince(a.paused.at.toISOString()), note: a.paused.note } : null,
  }));
}

function trustRows(input: ConfigureInput): ConfigureRow[] {
  return input.trust.map(t => ({
    id: t.key,
    // The name already carries the class a derived key narrows to; the raw
    // key is how trust.yaml spells it, one move away on the ladder.
    title: t.name,
    facts: [`${t.risk} risk`, t.runsOnItsOwn ? `above ${Math.round(t.minConfidence * 100)}% confidence` : t.rungLabel],
    figure: null,
    chip: t.flagged
      ? { label: 'Demoted', tone: 'bad' }
      : t.runsOnItsOwn ? { label: 'Runs on its own', tone: 'ok' } : { label: 'Asks', tone: 'muted' },
    href: AUTONOMY_HREF,
    preview: null,
  }));
}

function learningChip(status: string): ConfigureRow['chip'] {
  switch (status) {
    case 'adopted':
    case 'approved': return { label: 'Adopted', tone: 'ok' };
    case 'rejected': return { label: 'Rejected', tone: 'muted' };
    default: return { label: 'Pending', tone: 'warn' };
  }
}

function learningRows(input: ConfigureInput, now: number): ConfigureRow[] {
  return input.learnings.map(l => ({
    id: l.id,
    title: cut(l.text),
    facts: [l.origin ?? '', l.step],
    figure: l.at ? ageLabel(l.at, now) : null,
    chip: learningChip(l.status),
    href: l.step ? `${LEARNINGS_HREF}/${encodeURIComponent(l.step)}` : LEARNINGS_HREF,
    preview: null,
  }));
}

function measureRows(input: ConfigureInput): ConfigureRow[] {
  return input.measures.map(m => ({
    id: m.id,
    title: m.label,
    facts: [m.teamName, targetLine(m), m.sourceLabel],
    figure: valueLine(m),
    chip: measureChange(m),
    href: TEAM_REPORT_HREF,
    preview: null,
  }));
}

function tab(kind: ConfigureTabKind, label: string | undefined, input: ConfigureInput, now: number): ConfigureTab {
  const name = label ?? TAB_LABEL[kind];
  switch (kind) {
    case 'seats': {
      const over = input.seats.filter(s => s.overBudget).length;
      return { key: kind, label: name, count: input.seats.length, note: note([over > 0 ? `${over} over budget` : null]), rows: seatRows(input, now), empty: 'No agents ship with this plugin.' };
    }
    case 'skills': {
      const overrides = input.skills.filter(s => s.source === 'override').length;
      const drifted = input.skills.filter(s => s.drifted).length;
      return { key: kind, label: name, count: input.skills.length, note: note([overrides > 0 ? `${plural(overrides, 'override')} in the workspace` : null, drifted > 0 ? `${drifted} behind the plugin` : null]), rows: skillRows(input, now), empty: 'No skills or playbooks ship with this plugin.' };
    }
    case 'automations': {
      const paused = input.automations.filter(a => a.paused).length;
      const failing = input.automations.filter(a => !a.paused && a.last?.status === 'error').length;
      return { key: kind, label: name, count: input.automations.length, note: note([failing > 0 ? `${failing} failing` : null, paused > 0 ? `${paused} paused` : null]), rows: automationRows(input, now), empty: 'No automations ship with this plugin.' };
    }
    case 'trust': {
      const own = input.trust.filter(t => t.runsOnItsOwn).length;
      return { key: kind, label: name, count: input.trust.length, note: input.trust.length > 0 ? `${own} run on their own · ${input.trust.length - own} ask` : null, rows: trustRows(input), empty: 'This plugin ships no trust rules.' };
    }
    case 'learned': {
      const pending = input.learnings.filter(l => l.status === 'pending').length;
      return { key: kind, label: name, count: input.learnings.length, note: note([pending > 0 ? `${pending} to decide` : null]), rows: learningRows(input, now), empty: 'Nothing learned yet.' };
    }
    case 'measures': {
      const unread = input.measures.filter(m => m.value === null).length;
      return { key: kind, label: name, count: input.measures.length, note: note([unread > 0 ? `${unread} not read` : null]), rows: measureRows(input), empty: 'No measures declared on this plugin\'s team.' };
    }
  }
}

/**
 * What needs a person: an automation that errored, a seat its budget stopped,
 * an override the plugin moved on from, a rung demoted on its own, a measure
 * nothing could read. Links only — the work is on the page each one opens.
 * @param input - The page's reads.
 */
export function attentionItems(input: ConfigureInput): ConfigureAttention[] {
  const items: ConfigureAttention[] = [];
  for (const a of input.automations) {
    if (!a.paused && a.last?.status === 'error') {
      items.push({ id: `automation:${a.slug}`, label: a.name, detail: a.last.failedToStart ? 'Could not start' : 'Errored on its last run', href: `/dashboard/automation/${a.slug}` });
    }
  }
  for (const s of input.seats) {
    if (s.overBudget) {
      items.push({ id: `seat:${s.slug}`, label: s.name, detail: 'Over budget — new runs are refused', href: `/dashboard/agents/${s.slug}` });
    }
  }
  for (const s of input.skills) {
    if (s.drifted) {
      items.push({ id: `skill:${s.slug}`, label: s.name, detail: 'Your override is behind the plugin', href: `/dashboard/skills/${s.slug}` });
    }
  }
  for (const t of input.trust) {
    if (t.flagged) {
      items.push({ id: `trust:${t.key}`, label: t.name, detail: 'Demoted itself — asks again', href: AUTONOMY_HREF });
    }
  }
  for (const m of input.measures) {
    if (m.value === null) {
      items.push({ id: `measure:${m.id}`, label: m.label, detail: 'Nothing reads it yet — connect a source', href: TEAM_REPORT_HREF });
    }
  }
  return items;
}

function aside(kind: ConfigureAsideKind, label: string | undefined, input: ConfigureInput, now: number): ConfigureAside | null {
  const name = label ?? ASIDE_LABEL[kind];
  switch (kind) {
    case 'health':
      return input.measures.length === 0
        ? null
        : {
            kind,
            label: name,
            href: TEAM_REPORT_HREF,
            items: input.measures.map(m => ({ id: m.id, label: m.label, value: valueLine(m), target: targetLine(m), change: measureChange(m) })),
          };
    case 'attention': {
      // Absent when empty: a block saying nothing is wrong is a block to read
      // past, every time.
      const items = attentionItems(input);
      return items.length === 0 ? null : { kind, label: name, items };
    }
    case 'changes': {
      const items = [...input.changes]
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, CHANGES_SHOWN)
        .map(c => ({ id: c.id, label: c.what, href: c.href, who: c.who, when: ageLabel(c.at, now) }));
      return items.length === 0 ? null : { kind, label: name, items };
    }
  }
}

/**
 * The page, from its declaration and its reads.
 * @param input - What was read for the plugin's relations.
 * @param blocks - The page's declared tabs and sidebar (`configure:` on the manifest); omitted, all of them.
 * @param opts - The URL's tab and the clock.
 * @param opts.tab - `?tab=`.
 * @param opts.now - Epoch ms, one instant for every relative time on the page.
 */
export function planConfigure(input: ConfigureInput, blocks: ConfigureBlocks | undefined, opts: { tab?: string | string[]; now: number }): ConfigureView {
  const tabsDeclared = blocks?.tabs ?? CONFIGURE_TAB_KINDS.map(kind => ({ kind, label: undefined }));
  const asideDeclared = blocks?.aside ?? CONFIGURE_ASIDE_KINDS.map(kind => ({ kind, label: undefined }));
  const tabs = tabsDeclared.map(t => tab(t.kind, t.label, input, opts.now));
  return {
    tabs,
    active: chosenTab(tabs.map(t => t.key), opts.tab),
    aside: asideDeclared.map(a => aside(a.kind, a.label, input, opts.now)).filter((a): a is ConfigureAside => a !== null),
  };
}
