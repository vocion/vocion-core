import type { PageOverviewPanel, PagePanelFact, PageRow } from '@/libs/workspace/pageFields';
import type { HumanLoad } from '@/services/team-report/humanLoad';
import { formatMoney, resolveField } from '@/libs/workspace/pageFields';
import { readReasons, reasonSummary } from '@/libs/workspace/reasonCodes';

/**
 * The `overview` archetype's assembly - pure, no database, no clock of its
 * own. `overviewData.ts` reads the rows; this turns them into a briefing.
 *
 * The page does not explain the factory's records. It briefs a person on
 * their factory, in the order an executive team speaks: here is my read, here
 * is what only you can decide, here is what is being built, here is what we
 * intend next, here is what changed, and here is what it cost.
 *
 * Four rules shape every function below.
 *
 *  1. **The judgment line is derived, not authored.** {@link judgmentLine}
 *     runs LAST, over the panels that were already assembled, so the sentence
 *     at the top cannot contradict the panels beneath it. When the records
 *     cannot support a confident reading it says something true and narrow.
 *     It never reads as moving when nothing is moving.
 *  2. **A heading is a promise.** "In progress" lists only outcomes where a
 *     worker is on the work right now. Approved, queued and awaiting-review
 *     outcomes are accounted for in one line and live on Work.
 *  3. **Nothing is ranked without a reason.** A record carrying no reason
 *     code cannot enter the ranked Next list. The shortfall surfaces once, as
 *     a factory quality defect, never one row at a time.
 *  4. **Conclusions here, method behind an affordance.** A panel's `method`
 *     text is carried but is never drawn beside a number, and a figure the
 *     records cannot support is left out rather than drawn as NOT MEASURABLE.
 *     Instrumentation gaps are not a management surface.
 */

/** A business object, in the shape the page accessors already understand. */
export type OverviewRecord = PageRow & {
  typeSlug: string;
  updatedAt: Date | null;
};

/** One option offered on a decision. */
export type OverviewAskOption = {
  label: string;
  recommended?: boolean;
};

/** One decision waiting on (or answered by) a person. */
export type OverviewAsk = {
  id: number;
  kind: string;
  title: string;
  risk: string | null;
  /** Minutes of attention the decision was estimated to take, when recorded. */
  decisionCost: number | null;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  /** The records the question is about. Empty means nothing links it to work. */
  objectRefs: unknown;
  /** `<subject>:<detail>` - what the decision is about, when the filer said. */
  sourceRef: string | null;
  /** An explicit "these are one decision sheet" key from the write side. */
  groupKey: string | null;
  /** The named answers, including which one the filer recommends. */
  options: readonly OverviewAskOption[];
};

/** One agent-proposed action sitting in the review queue. */
export type OverviewProposal = {
  id: number;
  title: string;
  /** The action being proposed. Many proposals of one action is a trust gap. */
  actionId: string;
  createdAt: Date;
};

export type OverviewInput = {
  panels: readonly PageOverviewPanel[];
  /** Every business object of every type a panel names. */
  records: readonly OverviewRecord[];
  /** Open asks, plus any decided inside the widest window a panel asks for. */
  asks: readonly OverviewAsk[];
  /** Action-run proposals waiting on a person right now. */
  pendingProposals: readonly OverviewProposal[];
  /** The org-wide human-load fold, or null when it could not be read. */
  humanLoad: HumanLoad | null;
  /** When this viewer last opened this page. Null means never. */
  lastSeenAt: Date | null;
  now: Date;
};

export type OverviewFigure = {
  label: string;
  value: string;
  /** The one fact that makes the figure readable. Never methodology. */
  note?: string;
};

export type OverviewStatusRow = {
  id: string | number;
  headline: string;
  /** The row read as a sentence, not as a row of fields. */
  summary: string;
  href: string | null;
};

export type OverviewActiveRow = {
  id: string | number;
  title: string;
  progress: string;
  href: string | null;
};

export type OverviewNextRow = {
  id: string | number;
  title: string;
  why: string;
  href: string | null;
};

/** One decision, as a person meets it: what it is and what is recommended. */
export type OverviewDecisionRow = {
  id: string | number;
  title: string;
  /** The filer's recommended option, or null when it offered none. */
  recommendation: string | null;
  blocksWork: boolean;
  /** How many further open records restate this same decision. */
  restated: number;
  href: string | null;
};

export type OverviewPanelView
  = | { kind: 'judgment'; title: string; line: string }
    | { kind: 'status'; title: string; note?: string; method?: string; rows: OverviewStatusRow[]; empty: string | null }
    | { kind: 'digest'; title: string; note?: string; method?: string; heading: string; sinceKnown: boolean; since: Date; lines: string[]; collapsed: string | null }
    | { kind: 'active'; title: string; note?: string; method?: string; rows: OverviewActiveRow[]; more: number; empty: string | null }
    | { kind: 'next'; title: string; note?: string; method?: string; rows: OverviewNextRow[]; unreasoned: string | null; empty: string | null }
    | { kind: 'needsYou'; title: string; note?: string; method?: string; href: string; count: number; blocking: number; rows: OverviewDecisionRow[]; more: number; accounting: string | null; collapsed: string | null }
    | { kind: 'economics'; title: string; note?: string; method?: string; figures: OverviewFigure[] }
    | { kind: 'autonomy'; title: string; note?: string; method?: string; figures: OverviewFigure[]; sentence: string | null };

export type FactoryOverview = {
  panels: OverviewPanelView[];
  /** The stamp the digest measured from, so the page can record the visit. */
  lastSeenAt: Date | null;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * Records of one type, in the order they were read.
 * @param records
 * @param typeSlug
 */
function ofType(records: readonly OverviewRecord[], typeSlug: string): OverviewRecord[] {
  return records.filter(r => r.typeSlug === typeSlug);
}

/**
 * A join key, lower-cased and trimmed, or null when the accessor is empty.
 * @param raw
 */
function key(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim().toLowerCase();
  }
  if (typeof raw === 'number') {
    return String(raw);
  }
  return null;
}

/**
 * The first accessor that yields a join key on this record.
 * @param record
 * @param accessors
 */
function subjectKey(record: OverviewRecord, accessors: readonly string[]): string | null {
  for (const from of accessors) {
    const k = key(resolveField(record, from));
    if (k !== null) {
      return k;
    }
  }
  return null;
}

function asDate(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

/**
 * The first of `fields` that carries a date on this record, and which one it
 * was. The caller reports the field, because "accepted at 14:02" and "updated
 * some time since you looked" are different strengths of evidence.
 * @param record
 * @param fields
 */
function stamp(record: OverviewRecord, fields: readonly string[]): { at: Date; from: string } | null {
  for (const from of fields) {
    const at = from === 'updatedAt' ? record.updatedAt : from === 'createdAt' ? record.createdAt : asDate(resolveField(record, from));
    if (at) {
      return { at, from };
    }
  }
  return null;
}

function numberAt(record: OverviewRecord, from: string): number | null {
  const raw = resolveField(record, from);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

function textAt(record: OverviewRecord, from: string): string {
  const raw = resolveField(record, from);
  if (raw === null || raw === undefined || raw === '') {
    return '';
  }
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'object') {
    return '';
  }
  return String(raw);
}

/**
 * `/dashboard/objects/{id}` with `{id}` filled, or null when no link is set.
 * @param template
 * @param id
 */
function linkFor(template: string | undefined, id: string | number): string | null {
  return template ? template.replace('{id}', String(id)) : null;
}

/**
 * "3 requests", "1 request" - the label is already plural, so 1 drops the s.
 * @param n
 * @param label
 */
function countLabel(n: number, label: string): string {
  if (n !== 1) {
    return `${n} ${label}`;
  }
  // Labels are authored plural. At one, the first plural WORD loses its s, so
  // a panel never reads "1 decisions arrived" and nobody has to author two
  // spellings of every label.
  const words = label.split(' ');
  const i = words.findIndex(w => w.length > 1 && w.endsWith('s'));
  if (i >= 0) {
    words[i] = words[i]!.slice(0, -1);
  }
  return `${n} ${words.join(' ')}`;
}

function percent(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)}%`;
}

/**
 * "3 days", "14 hours" - how far back the digest is reaching.
 * @param ms
 */
export function describeAge(ms: number): string {
  if (ms < HOUR_MS) {
    return countLabel(Math.max(1, Math.round(ms / 60_000)), 'minutes');
  }
  if (ms < DAY_MS) {
    return countLabel(Math.round(ms / HOUR_MS), 'hours');
  }
  return countLabel(Math.round(ms / DAY_MS), 'days');
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function factValue(record: OverviewRecord, fact: PagePanelFact, records: readonly OverviewRecord[]): string {
  if (fact.kind === 'field') {
    const value = textAt(record, fact.from);
    return value === '' ? 'not recorded' : value;
  }
  const k = subjectKey(record, fact.subjectFields);
  if (k === null) {
    return '0';
  }
  const related = ofType(records, fact.objectType).filter((r) => {
    if (key(resolveField(r, fact.relatedField)) !== k) {
      return false;
    }
    const status = r.status ?? '';
    if (fact.status && !fact.status.includes(status)) {
      return false;
    }
    return !(fact.excludeStatus && fact.excludeStatus.includes(status));
  });
  return String(related.length);
}

/**
 * One product as a sentence.
 *
 * The semantic move is the health clause. A product whose health reads
 * `unknown` and which no work of any kind points at is not merely unknown:
 * nothing is connected to it. That is a grey label turned into something a
 * person can act on.
 * @param panel - The status panel's config.
 * @param record - One product.
 * @param input - The assembled input.
 */
function productSummary(panel: Extract<PageOverviewPanel, { kind: 'status' }>, record: OverviewRecord, input: OverviewInput): string {
  const counts = panel.facts
    .filter(f => f.kind === 'related')
    .map(f => ({ label: f.label, n: Number(factValue(record, f, input.records)) }));
  const attached = counts.reduce((sum, c) => sum + (Number.isFinite(c.n) ? c.n : 0), 0);
  const stage = panel.facts.find(f => f.kind === 'field' && f.from !== panel.healthField);
  const stageText = stage && stage.kind === 'field' ? textAt(record, stage.from) : '';

  const health = panel.healthField ? textAt(record, panel.healthField).trim().toLowerCase() : '';
  const unknown = panel.healthField !== undefined && panel.unknownHealth.includes(health);

  if (unknown && attached === 0) {
    return stageText === ''
      ? 'Not connected to the factory: no work, and nothing reports its health.'
      : `${stageText}, but not connected to the factory: no work, and nothing reports its health.`;
  }

  const parts: string[] = [];
  if (stageText !== '') {
    parts.push(stageText);
  }
  if (panel.healthField) {
    parts.push(health === '' ? 'health not recorded' : `health ${health}`);
  }
  const work = counts.filter(c => c.n > 0).map(c => countLabel(c.n, c.label));
  parts.push(work.length > 0 ? work.join(', ') : 'nothing open');
  return `${parts.join(' · ')}.`;
}

function statusPanel(panel: Extract<PageOverviewPanel, { kind: 'status' }>, input: OverviewInput): OverviewPanelView {
  const rows = ofType(input.records, panel.objectType).map(record => ({
    id: record.id,
    headline: textAt(record, panel.headline) || record.title,
    summary: productSummary(panel, record, input),
    href: linkFor(panel.rowLink, record.id),
  }));
  return {
    kind: 'status',
    title: panel.title,
    note: panel.note,
    method: panel.method,
    rows,
    empty: rows.length === 0 ? 'No product has been stood up yet.' : null,
  };
}

// ---------------------------------------------------------------------------
// Since last visit
// ---------------------------------------------------------------------------

/**
 * The digest window and the heading that names it honestly.
 *
 * A first visit has no "since you last looked". Rather than quietly show a
 * default window under that heading, the panel says the window is a fallback
 * and that the page will remember this visit.
 * @param panel - The digest panel's config.
 * @param input - The assembled input.
 */
export function digestWindow(panel: Extract<PageOverviewPanel, { kind: 'digest' }>, input: OverviewInput): { since: Date; sinceKnown: boolean; heading: string } {
  if (input.lastSeenAt) {
    return {
      since: input.lastSeenAt,
      sinceKnown: true,
      heading: `${describeAge(Math.max(0, input.now.getTime() - input.lastSeenAt.getTime()))} ago`,
    };
  }
  return {
    since: new Date(input.now.getTime() - panel.fallbackHours * HOUR_MS),
    sinceKnown: false,
    heading: `the last ${countLabel(panel.fallbackHours, 'hours')}, since you have not opened this page before`,
  };
}

function digestPanel(panel: Extract<PageOverviewPanel, { kind: 'digest' }>, input: OverviewInput): OverviewPanelView {
  const { since, sinceKnown, heading } = digestWindow(panel, input);
  const lines: string[] = [];

  for (const arrival of panel.arrivals) {
    const n = ofType(input.records, arrival.objectType)
      .map(r => stamp(r, arrival.dateFields))
      .filter(x => x !== null && x.at >= since)
      .length;
    if (n > 0) {
      lines.push(countLabel(n, arrival.label));
    }
  }

  for (const transition of panel.transitions) {
    const moved = ofType(input.records, transition.objectType)
      .filter(r => transition.to.includes(r.status ?? ''))
      .map(r => ({ record: r, stamp: stamp(r, transition.dateFields) }))
      .filter((x): x is { record: OverviewRecord; stamp: { at: Date; from: string } } => x.stamp !== null && x.stamp.at >= since)
      .sort((a, b) => b.stamp.at.getTime() - a.stamp.at.getTime());
    if (moved.length === 0) {
      continue;
    }
    const named = moved.slice(0, transition.detail).map(x => x.record.title);
    const rest = moved.length - named.length;
    lines.push(named.length > 0
      ? `${transition.label}: ${named.join(' · ')}${rest > 0 ? ` and ${countLabel(rest, 'more')}` : ''}`
      : countLabel(moved.length, transition.label));
  }

  for (const rollup of panel.rollups) {
    const inWindow = ofType(input.records, rollup.objectType)
      .map(r => ({ record: r, stamp: stamp(r, rollup.dateFields) }))
      .filter(x => x.stamp !== null && x.stamp.at >= since);
    if (inWindow.length === 0) {
      continue;
    }
    const cents = rollup.moneyField
      ? inWindow.map(x => numberAt(x.record, rollup.moneyField!)).filter((n): n is number => n !== null)
      : [];
    const total = cents.reduce((a, b) => a + b, 0);
    lines.push(rollup.moneyField && cents.length > 0
      ? `${formatMoney(total)} across ${countLabel(inWindow.length, rollup.label)}`
      : countLabel(inWindow.length, rollup.label));
  }

  if (panel.decisions) {
    const arrived = input.asks.filter(a => a.createdAt >= since && (panel.decisions!.risk.length === 0 || (a.risk !== null && panel.decisions!.risk.includes(a.risk))));
    if (arrived.length > 0) {
      lines.push(countLabel(arrived.length, panel.decisions.label));
    }
  }

  return {
    kind: 'digest',
    title: panel.title,
    note: panel.note,
    method: panel.method,
    heading,
    sinceKnown,
    since,
    lines,
    // Empty, the section is one line and takes no more room than it earns.
    collapsed: lines.length === 0 ? `Nothing changed in ${heading}.` : null,
  };
}

// ---------------------------------------------------------------------------
// In progress
// ---------------------------------------------------------------------------

function inFlight(record: OverviewRecord, statusIn: readonly string[], stateField: string | undefined, stateIn: readonly string[] | undefined): boolean {
  if (!statusIn.includes(record.status ?? '')) {
    return false;
  }
  if (!stateField || !stateIn || stateIn.length === 0) {
    return true;
  }
  const state = textAt(record, stateField);
  return stateIn.includes(state);
}

/**
 * Outcomes a worker is on right now, and an honest account of the rest.
 *
 * Membership is decided by the tasks, not by the outcome's own status. An
 * outcome with no contracted task is approved or queued; an outcome whose
 * tasks have all stopped is waiting on a review. Neither is in flight, and
 * listing either under a heading that promises work in flight is what made
 * the whole page feel unreliable. Both are counted in the empty line so the
 * work that left this panel is still accounted for.
 * @param panel - The active panel's config.
 * @param input - The assembled input.
 */
function activePanel(panel: Extract<PageOverviewPanel, { kind: 'active' }>, input: OverviewInput): OverviewPanelView {
  const approved = ofType(input.records, panel.objectType)
    .filter(r => inFlight(r, panel.statusIn, panel.stateField, panel.stateIn));

  const tasksCfg = panel.tasks;
  if (!tasksCfg) {
    return {
      kind: 'active',
      title: panel.title,
      note: panel.note,
      method: panel.method,
      rows: [],
      more: 0,
      empty: 'This panel names no task records, so it cannot tell work in progress from work merely approved.',
    };
  }

  const allTasks = ofType(input.records, tasksCfg.objectType);
  const tasksOf = (record: OverviewRecord) => allTasks.filter(t => key(resolveField(t, tasksCfg.joinField)) === key(record.id));

  const working = approved.filter(r => tasksOf(r).some(t => tasksCfg.workingStatus.includes(t.status ?? '')));
  const queued = approved.filter(r => tasksOf(r).length === 0);
  const waiting = allTasks.filter(t => tasksCfg.waitingStatus.includes(t.status ?? ''));

  const rows: OverviewActiveRow[] = working
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
    .slice(0, panel.limit)
    .map((record) => {
      const mine = tasksOf(record);
      const complete = mine.filter(t => tasksCfg.completeStatus.includes(t.status ?? '')).length;
      const live = mine.filter(t => tasksCfg.workingStatus.includes(t.status ?? '')).length;
      return {
        id: record.id,
        title: record.title,
        progress: `${countLabel(live, 'tasks')} running, ${complete} of ${mine.length} done`,
        href: linkFor(panel.rowLink, record.id),
      };
    });

  // The empty state is designed, not defaulted: it says what left the panel
  // and where it went, so a quiet section never reads as a missing section.
  const elsewhere: string[] = [];
  if (queued.length > 0) {
    elsewhere.push(`${countLabel(queued.length, 'approved outcomes')} ${queued.length === 1 ? 'has' : 'have'} no task contract yet`);
  }
  if (waiting.length > 0) {
    elsewhere.push(`${countLabel(waiting.length, 'changes')} ${waiting.length === 1 ? 'is' : 'are'} waiting on a review`);
  }
  const account = elsewhere.length > 0 ? ` ${elsewhere.join(' and ')}; both are on Work.` : '';

  return {
    kind: 'active',
    title: panel.title,
    note: panel.note,
    method: panel.method,
    rows,
    more: Math.max(0, working.length - rows.length),
    empty: rows.length === 0 ? `Nothing is being built right now.${account}` : null,
  };
}

// ---------------------------------------------------------------------------
// Next
// ---------------------------------------------------------------------------

/**
 * What the factory intends to spend effort on next, and why.
 *
 * Nothing becomes prioritised work without a recorded reason. A queued record
 * carrying no reason code cannot enter the ranked list at all - not greyed
 * out, not last, not at all - because a rank without a reason is a number
 * asking a person to trust it. The shortfall surfaces once, as a factory
 * quality defect, rather than being absorbed one row at a time.
 * @param panel - The next panel's config.
 * @param input - The assembled input.
 */
function nextPanel(panel: Extract<PageOverviewPanel, { kind: 'next' }>, input: OverviewInput): OverviewPanelView {
  const pool = ofType(input.records, panel.objectType).filter((r) => {
    if (panel.statusIn && !panel.statusIn.includes(r.status ?? '')) {
      return false;
    }
    if (!panel.stateField || !panel.stateIn || panel.stateIn.length === 0) {
      return true;
    }
    return panel.stateIn.includes(textAt(r, panel.stateField));
  });

  const noteFields = panel.noteFields.map(f => (f.startsWith('meta.') ? f.slice(5) : f));
  const withReason = pool.filter(r => readReasons(r.meta, noteFields).recorded);
  const unreasoned = pool.length - withReason.length;

  // `orderBy` decides the order and is never rendered: a priority integer is a
  // ranking, not an answer.
  const ordered = [...withReason].sort((a, b) => {
    const ra = numberAt(a, panel.orderBy);
    const rb = numberAt(b, panel.orderBy);
    if (ra !== rb) {
      if (ra === null) {
        return 1;
      }
      if (rb === null) {
        return -1;
      }
      return rb - ra;
    }
    return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  });

  const rows: OverviewNextRow[] = ordered.slice(0, panel.limit).map(record => ({
    id: record.id,
    title: record.title,
    why: reasonSummary(readReasons(record.meta, noteFields)),
    href: linkFor(panel.rowLink, record.id),
  }));

  return {
    kind: 'next',
    title: panel.title,
    note: panel.note,
    method: panel.method,
    rows,
    unreasoned: unreasoned > 0
      ? `${countLabel(unreasoned, 'queued requests')} carry no recorded reason, so they cannot be ranked. Recording why is what puts them in this list.`
      : null,
    empty: rows.length === 0
      ? pool.length === 0
        ? 'Nothing is queued. The factory intends no new work.'
        : 'Nothing can be ranked: every queued request is missing its reason, so the factory has no defensible order to work in.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * What an open decision is ABOUT, for collapsing restatements of one question.
 *
 * `groupKey` is the write side saying so outright. Failing that a `sourceRef`
 * reads `<subject>:<detail>`, and its subject is the decision's topic - unless
 * that subject names a single record, in which case two decisions under it are
 * genuinely two decisions and the whole ref is the key.
 * @param ask - One open decision.
 * @param perRecordSources - Prefixes that name a record rather than a subject.
 */
export function decisionSubject(ask: OverviewAsk, perRecordSources: readonly string[]): string {
  if (ask.groupKey && ask.groupKey.trim() !== '') {
    return `group:${ask.groupKey.trim()}`;
  }
  const ref = (ask.sourceRef ?? '').trim();
  if (ref === '') {
    return `ask:${ask.id}`;
  }
  const colon = ref.indexOf(':');
  if (colon <= 0) {
    return `ref:${ref}`;
  }
  const prefix = ref.slice(0, colon);
  return perRecordSources.includes(prefix) ? `ref:${ref}` : `subject:${prefix}`;
}

/**
 * The decisions a person actually has to make, and one line for the rest.
 *
 * Two things are deliberately NOT counted here. A routine approval an agent
 * has already answered for itself is a yes waiting to be clicked, not a
 * judgment call, and it is accounted for in one line and tuned under Autonomy.
 * A restatement of a question already in this list is the factory re-filing,
 * not a person being asked twice, and it collapses into the decision it
 * restates. What is left is one number that means exactly what it says: human
 * judgment required.
 * @param panel - The needsYou panel's config.
 * @param input - The assembled input.
 */
function needsYouPanel(panel: Extract<PageOverviewPanel, { kind: 'needsYou' }>, input: OverviewInput): OverviewPanelView {
  const open = input.asks.filter(a => a.status === 'open');

  const bySubject = new Map<string, OverviewAsk[]>();
  for (const ask of open) {
    const subject = decisionSubject(ask, panel.perRecordSources);
    const group = bySubject.get(subject);
    if (group) {
      group.push(ask);
    } else {
      bySubject.set(subject, [ask]);
    }
  }

  const decisions = [...bySubject.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = sorted[0]!;
    const recommended = group.map(a => a.options.find(o => o.recommended)).find(o => o !== undefined);
    return {
      first,
      restated: group.length - 1,
      risk: Math.max(...group.map(a => RISK_RANK[a.risk ?? ''] ?? 0)),
      blocksWork: group.some(a => Array.isArray(a.objectRefs) && a.objectRefs.length > 0),
      recommendation: recommended ? recommended.label : null,
    };
  });

  const ranked = decisions.sort((a, b) => {
    if (a.blocksWork !== b.blocksWork) {
      return a.blocksWork ? -1 : 1;
    }
    if (a.risk !== b.risk) {
      return b.risk - a.risk;
    }
    return a.first.createdAt.getTime() - b.first.createdAt.getTime();
  });

  const rows: OverviewDecisionRow[] = ranked.slice(0, panel.limit).map(d => ({
    id: d.first.id,
    title: d.first.title,
    recommendation: d.recommendation,
    blocksWork: d.blocksWork,
    restated: d.restated,
    href: `${panel.href}?ask=${d.first.id}`,
  }));

  const restated = decisions.reduce((sum, d) => sum + d.restated, 0);
  const routine = input.pendingProposals.length;
  const rest: string[] = [];
  if (restated > 0) {
    rest.push(`${countLabel(restated, 'open records')} restate decisions already in this list`);
  }
  if (routine > 0) {
    rest.push(`${countLabel(routine, 'routine approvals')} are waiting on a yes an agent already recommended`);
  }

  return {
    kind: 'needsYou',
    title: panel.title,
    note: panel.note,
    method: panel.method,
    href: panel.href,
    count: decisions.length,
    blocking: decisions.filter(d => d.blocksWork).length,
    rows,
    more: Math.max(0, decisions.length - rows.length),
    accounting: rest.length > 0 ? `${rest.join('; ')}. Both are on Review.` : null,
    // Nothing needs a person: the whole section is one line.
    collapsed: decisions.length === 0
      ? routine > 0
        ? `Nothing needs your judgment. ${countLabel(routine, 'routine approvals')} are waiting on a yes on Review.`
        : 'Nothing needs you.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

/**
 * What the factory spent, what it bought, and what had to be done twice.
 *
 * A trend beats an explanation, so spend is reported against the window
 * before it whenever there IS a window before it. When there is not - a
 * factory two days old has no previous month - the panel says that in one
 * short clause rather than printing a change against zero.
 * @param panel - The economics panel's config.
 * @param input - The assembled input.
 */
function economicsPanel(panel: Extract<PageOverviewPanel, { kind: 'economics' }>, input: OverviewInput): OverviewPanelView {
  const windowMs = panel.windowDays * DAY_MS;
  const since = new Date(input.now.getTime() - windowMs);
  const before = new Date(since.getTime() - windowMs);

  const dated = ofType(input.records, panel.objectType)
    .map(r => ({ record: r, at: stamp(r, panel.dateFields)?.at ?? null }))
    .filter((x): x is { record: OverviewRecord; at: Date } => x.at !== null);
  const pool = dated.filter(x => x.at >= since).map(x => x.record);
  const prior = dated.filter(x => x.at >= before && x.at < since).map(x => x.record);

  const cents = (rows: OverviewRecord[]) => rows
    .map(r => numberAt(r, panel.costField))
    .filter((n): n is number => n !== null)
    .reduce((a, b) => a + b, 0);

  const spend = cents(pool);
  const priorSpend = cents(prior);
  const accepted = pool.filter(r => panel.acceptedStatus.includes(r.status ?? ''));
  const rework = pool.filter(r => panel.reworkStatus.includes(r.status ?? ''));
  const windowLabel = countLabel(panel.windowDays, 'days');

  const trend = prior.length === 0
    ? 'no earlier window to compare yet'
    : priorSpend === 0
      ? `nothing was spent in the ${windowLabel} before`
      : `${Math.abs(Math.round(((spend - priorSpend) / priorSpend) * 100))}% ${spend >= priorSpend ? 'up on' : 'down on'} the ${windowLabel} before`;

  const figures: OverviewFigure[] = [
    { label: `Spend, last ${windowLabel}`, value: formatMoney(spend), note: trend },
  ];

  if (accepted.length > 0) {
    figures.push({
      label: 'Cost per accepted change',
      value: formatMoney(Math.round(spend / accepted.length)),
      note: countLabel(accepted.length, 'changes accepted'),
    });
  }

  figures.push({
    label: 'Rework spend',
    value: formatMoney(cents(rework)),
    note: spend > 0
      ? `${Math.round((cents(rework) / spend) * 100)}% of spend, across ${countLabel(rework.length, 'attempts')} that did not land`
      : countLabel(rework.length, 'attempts that did not land'),
  });

  return { kind: 'economics', title: panel.title, note: panel.note, method: panel.method, figures };
}

// ---------------------------------------------------------------------------
// Autonomy
// ---------------------------------------------------------------------------

/**
 * Four numbers and one thing to do about them.
 *
 * "Meaningful decisions required" used to sit here beside an open-decision
 * count, and read together they said the factory made thirty-five
 * interruptions of which six mattered. They were never the same measure: one
 * is a queue, the other is throughput. This one is named for what it is -
 * decisions a person answered in the window - and the queue lives, once,
 * under Needs you.
 * @param panel - The autonomy panel's config.
 * @param input - The assembled input.
 */
function autonomyPanel(panel: Extract<PageOverviewPanel, { kind: 'autonomy' }>, input: OverviewInput): OverviewPanelView {
  const load = input.humanLoad;
  const figures: OverviewFigure[] = [];
  const windowLabel = countLabel(panel.windowDays, 'days');

  if (load && load.workItems > 0) {
    const unattended = percent(load.unattendedRate);
    if (unattended !== null) {
      figures.push({
        label: 'Finished without you',
        value: unattended,
        note: `${load.workItems - load.needingDecision} of ${countLabel(load.workItems, 'pieces of work')}`,
      });
    }
    const autoCompleted = percent(load.autonomousCompletionRate);
    if (autoCompleted !== null) {
      figures.push({
        label: 'Ran under a trust rule',
        value: autoCompleted,
        note: `${load.autoExecuted} of ${countLabel(load.executed, 'executed actions')}`,
      });
    }
  }

  if (load) {
    figures.push({
      label: `Decisions you answered, last ${windowLabel}`,
      value: String(load.interventions),
      note: 'throughput, not the queue: what is open is under Needs you',
    });
    figures.push({
      label: 'Approved unchanged',
      value: String(load.approvedClean),
      note: 'asked for, then waved through without an edit',
    });
  }

  // One thing to do. The biggest repeated proposal is the strongest signal a
  // trust rule would pay, because a person clicking the same yes over and over
  // is the factory asking a question policy could answer.
  const byAction = new Map<string, number>();
  for (const proposal of input.pendingProposals) {
    byAction.set(proposal.actionId, (byAction.get(proposal.actionId) ?? 0) + 1);
  }
  const repeated = [...byAction.entries()].sort((a, b) => b[1] - a[1])[0];
  let sentence: string | null = null;
  if (repeated && repeated[1] >= 3) {
    sentence = `${countLabel(repeated[1], 'queued approvals')} are all ${repeated[0]}. A trust rule for it would take them off your desk.`;
  } else if (load && load.approvedClean >= 3) {
    sentence = `${countLabel(load.approvedClean, 'approvals')} were accepted unchanged in the last ${windowLabel} and are candidates for more autonomy.`;
  }

  return { kind: 'autonomy', title: panel.title, note: panel.note, method: panel.method, figures, sentence };
}

// ---------------------------------------------------------------------------
// The judgment line
// ---------------------------------------------------------------------------

/**
 * One synthesised sentence, derived from the panels that were just assembled.
 *
 * It reads the assembled views rather than the raw records on purpose: the
 * line at the top of the page can then only say what the page below it
 * already says. It states facts - not a score, not a colour - and it will not
 * reach for a confident reading the records do not support. Above all it
 * never reads as moving over a factory that is stuck: the first clause is
 * decided by whether anything is actually being built and whether anyone is
 * waiting on a person.
 * @param assembled - Every other panel, already computed.
 */
export function judgmentLine(assembled: readonly OverviewPanelView[]): string {
  const needs = assembled.find(p => p.kind === 'needsYou');
  const active = assembled.find(p => p.kind === 'active');
  const next = assembled.find(p => p.kind === 'next');
  const economics = assembled.find(p => p.kind === 'economics');

  const building = active ? active.rows.length : 0;
  const decisions = needs ? needs.count : 0;
  const blocking = needs ? needs.blocking : 0;
  const queued = next ? next.rows.length : 0;

  // Nothing to read. Say that, narrowly, rather than inventing a state.
  if (!needs && !active) {
    return 'Not enough is recorded yet to say how the factory is doing.';
  }
  if (building === 0 && decisions === 0 && queued === 0) {
    return next && next.unreasoned !== null
      ? 'Idle. Nothing is being built and nothing needs you, but the queue cannot be ranked until requests record why they matter.'
      : 'Idle. Nothing is being built, nothing is queued and nothing needs you.';
  }

  const clauses: string[] = [];

  if (building === 0 && decisions > 0) {
    clauses.push(`Stalled: nothing is being built and ${countLabel(decisions, 'decisions')} ${decisions === 1 ? 'is' : 'are'} waiting on you`);
    if (blocking > 0) {
      clauses.push(`${blocking} of them ${blocking === 1 ? 'names' : 'name'} work ${blocking === 1 ? 'it is' : 'they are'} holding up`);
    }
  } else if (building === 0) {
    clauses.push(`Nothing is being built, and ${countLabel(queued, 'requests')} ${queued === 1 ? 'is' : 'are'} ranked and waiting to start`);
  } else if (decisions > 0) {
    clauses.push(`${countLabel(building, 'outcomes')} in progress, ${countLabel(decisions, 'decisions')} waiting on you${blocking > 0 ? `, ${blocking} of them blocking work` : ''}`);
  } else {
    clauses.push(`${countLabel(building, 'outcomes')} in progress and nothing needs you`);
  }

  // The one clause that stops the sentence overclaiming. When most of what
  // the factory attempted had to be done again, no reading of the top line
  // is allowed to sound like things are going well.
  if (economics) {
    const rework = economics.figures.find(f => f.label === 'Rework spend');
    const share = rework?.note?.match(/^(\d+)% of spend, across (\d+) attempts?/);
    if (share && Number(share[1]) >= 40) {
      clauses.push(`${share[1]}% of recent spend went on attempts that did not land`);
    }
  }

  return `${clauses.join('. ')}.`;
}

/**
 * Compute every panel the manifest declares, in the order it declares them.
 * Pure: the same input always yields the same page.
 * @param input - Records, decisions, the human-load fold, the viewer's last
 *   visit and the clock. See {@link OverviewInput}.
 */
export function assembleOverview(input: OverviewInput): FactoryOverview {
  // Everything but the judgment line first, so the judgment line can be
  // derived from what the page is actually going to say.
  const assembled = input.panels.map((panel): OverviewPanelView | null => {
    switch (panel.kind) {
      case 'judgment':
        return null;
      case 'status':
        return statusPanel(panel, input);
      case 'digest':
        return digestPanel(panel, input);
      case 'active':
        return activePanel(panel, input);
      case 'next':
        return nextPanel(panel, input);
      case 'needsYou':
        return needsYouPanel(panel, input);
      case 'economics':
        return economicsPanel(panel, input);
      case 'autonomy':
        return autonomyPanel(panel, input);
      default:
        throw new Error(`unknown overview panel kind`);
    }
  });

  const computed = assembled.filter((p): p is OverviewPanelView => p !== null);
  const panels = input.panels.map((panel, i): OverviewPanelView => (
    panel.kind === 'judgment'
      ? { kind: 'judgment', title: panel.title, line: judgmentLine(computed) }
      : assembled[i]!
  ));

  return { panels, lastSeenAt: input.lastSeenAt };
}
