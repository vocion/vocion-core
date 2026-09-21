import type { PageOverviewPanel, PagePanelFact, PageRow } from '@/libs/workspace/pageFields';
import type { HumanLoad } from '@/services/team-report/humanLoad';
import { formatMoney, resolveField } from '@/libs/workspace/pageFields';
import { readReasons, reasonSummary } from '@/libs/workspace/reasonCodes';

/**
 * The `overview` archetype's assembly - pure, no database, no clock of its
 * own. `overviewData.ts` reads the rows; this turns them into panels.
 *
 * Six questions, above the fold, in sixty seconds: what is true, what changed
 * since I last looked, what is happening now, what is planned next and why,
 * what needs me, and is it worth what it costs.
 *
 * The rule that shapes every function here: a figure the records cannot
 * support is not drawn. It becomes a GAP - a named measure with the reason it
 * is not measurable yet, in the place the number would have been. Three of
 * those reasons are live today and each is a real hole in the write side, not
 * a hole in this file:
 *
 *  - how many open decisions BLOCK work, when no open decision names the
 *    record it is holding up (`ask.objectRefs` empty);
 *  - minutes of human attention, when a decision carries no `decisionCost`
 *    estimate and a queued proposal carries none at all;
 *  - cost per accepted change, when nothing was accepted in the window.
 *
 * The autonomy panel keeps two measures apart on purpose. Work autonomy ("how
 * much finished without a person") and human-interruption quality ("how much
 * of a person's day this took, and how much of that was worth taking") are
 * different questions. Averaged into one reassuring number they answer
 * neither, so they are reported side by side and the second is named for what
 * it is.
 */

/** A business object, in the shape the page accessors already understand. */
export type OverviewRecord = PageRow & {
  typeSlug: string;
  updatedAt: Date | null;
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
};

/** One agent-proposed action sitting in the review queue. */
export type OverviewProposal = {
  id: number;
  title: string;
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
  /** How the figure was computed, in a person's words. */
  note?: string;
};

/** A measure that is NOT drawn, and the reason it cannot be. */
export type OverviewGap = {
  label: string;
  why: string;
};

export type OverviewStatusRow = {
  id: string | number;
  headline: string;
  facts: Array<{ label: string; value: string }>;
  href: string | null;
};

export type OverviewActiveRow = {
  id: string | number;
  title: string;
  progress: string;
  waitingOn: string;
  href: string | null;
};

export type OverviewNextRow = {
  id: string | number;
  title: string;
  why: string;
  reasonRecorded: boolean;
  href: string | null;
};

export type OverviewPanelView
  = | { kind: 'status'; title: string; note?: string; rows: OverviewStatusRow[]; empty: string | null }
    | { kind: 'digest'; title: string; note?: string; heading: string; sinceKnown: boolean; since: Date; lines: string[]; empty: string | null }
    | { kind: 'active'; title: string; note?: string; rows: OverviewActiveRow[]; more: number; empty: string | null }
    | { kind: 'next'; title: string; note?: string; rows: OverviewNextRow[]; empty: string | null }
    | { kind: 'needsYou'; title: string; note?: string; href: string; figures: OverviewFigure[]; gaps: OverviewGap[] }
    | { kind: 'economics'; title: string; note?: string; figures: OverviewFigure[]; gaps: OverviewGap[] }
    | { kind: 'autonomy'; title: string; note?: string; work: OverviewFigure[]; attention: OverviewFigure[]; gaps: OverviewGap[] };

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
// Panels
// ---------------------------------------------------------------------------

function factValue(record: OverviewRecord, fact: PagePanelFact, records: readonly OverviewRecord[]): string {
  if (fact.kind === 'field') {
    const value = textAt(record, fact.from);
    return value === '' ? 'not recorded' : value;
  }
  const k = subjectKey(record, fact.subjectFields);
  if (k === null) {
    return 'no key to count by';
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

function statusPanel(panel: Extract<PageOverviewPanel, { kind: 'status' }>, input: OverviewInput): OverviewPanelView {
  const rows = ofType(input.records, panel.objectType).map(record => ({
    id: record.id,
    headline: textAt(record, panel.headline) || record.title,
    facts: panel.facts.map(fact => ({ label: fact.label, value: factValue(record, fact, input.records) })),
    href: linkFor(panel.rowLink, record.id),
  }));
  return {
    kind: 'status',
    title: panel.title,
    note: panel.note,
    rows,
    empty: rows.length === 0 ? `No ${panel.objectType} records exist yet, so there is nothing to report the state of.` : null,
  };
}

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
      heading: `Since you last looked, ${describeAge(Math.max(0, input.now.getTime() - input.lastSeenAt.getTime()))} ago`,
    };
  }
  return {
    since: new Date(input.now.getTime() - panel.fallbackHours * HOUR_MS),
    sinceKnown: false,
    heading: `The last ${countLabel(panel.fallbackHours, 'hours')} - you have not opened this page before, so this is a fixed window, not your own`,
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
    const head = named.length > 0
      ? `${transition.label}: ${named.join(' · ')}${rest > 0 ? ` and ${countLabel(rest, 'more')}` : ''}`
      : countLabel(moved.length, transition.label);
    // Only `updatedAt` is an inference - every other field is the record's own
    // stamp for the change. Say which, rather than let the reader assume.
    const inferred = moved.filter(x => x.stamp.from === 'updatedAt').length;
    lines.push(inferred === 0 ? head : `${head} (${inferred === moved.length ? 'timing' : `timing for ${inferred}`} read from last update, not a recorded stamp)`);
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
    if (rollup.moneyField && cents.length > 0) {
      const priced = cents.length === inWindow.length ? '' : `, ${cents.length} of them priced`;
      lines.push(`${formatMoney(total)} across ${countLabel(inWindow.length, rollup.label)}${priced}`);
    } else {
      lines.push(countLabel(inWindow.length, rollup.label));
    }
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
    heading,
    sinceKnown,
    since,
    lines,
    empty: lines.length === 0 ? 'Nothing a person would call a change. Deploys and worker runs are on Activity.' : null,
  };
}

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

function activePanel(panel: Extract<PageOverviewPanel, { kind: 'active' }>, input: OverviewInput): OverviewPanelView {
  const pool = ofType(input.records, panel.objectType)
    .filter(r => inFlight(r, panel.statusIn, panel.stateField, panel.stateIn))
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));

  const tasksCfg = panel.tasks;
  const allTasks = tasksCfg ? ofType(input.records, tasksCfg.objectType) : [];

  const rows: OverviewActiveRow[] = pool.slice(0, panel.limit).map((record) => {
    if (!tasksCfg) {
      return {
        id: record.id,
        title: record.title,
        progress: 'no task records are configured for this panel',
        waitingOn: 'not measurable',
        href: linkFor(panel.rowLink, record.id),
      };
    }
    const mine = allTasks.filter(t => key(resolveField(t, tasksCfg.joinField)) === key(record.id));
    const complete = mine.filter(t => tasksCfg.completeStatus.includes(t.status ?? '')).length;
    const waiting = mine.find(t => tasksCfg.waitingStatus.includes(t.status ?? ''));
    const progress = mine.length === 0
      ? 'no task has been contracted yet'
      : `${complete}/${mine.length} tasks complete`;
    const waitingOn = waiting
      ? `a person: "${waiting.title}" is ${waiting.status}`
      : mine.length === 0
        ? 'a task contract'
        : complete === mine.length
          ? 'nothing - every task is complete and the outcome is still open'
          : 'the factory: work is in progress';
    return { id: record.id, title: record.title, progress, waitingOn, href: linkFor(panel.rowLink, record.id) };
  });

  return {
    kind: 'active',
    title: panel.title,
    note: panel.note,
    rows,
    more: Math.max(0, pool.length - rows.length),
    empty: rows.length === 0 ? 'Nothing is in flight. Everything asked for has been answered or shipped.' : null,
  };
}

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

  // `orderBy` decides the order and is never rendered. A record with no rank
  // sorts last rather than being dropped: it is still queued, it just has not
  // been ranked, and hiding it would understate the queue.
  const ordered = [...pool].sort((a, b) => {
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

  const rows: OverviewNextRow[] = ordered.slice(0, panel.limit).map((record) => {
    const reasons = readReasons(record.meta, panel.noteFields.map(f => (f.startsWith('meta.') ? f.slice(5) : f)));
    return {
      id: record.id,
      title: record.title,
      why: reasonSummary(reasons),
      reasonRecorded: reasons.recorded,
      href: linkFor(panel.rowLink, record.id),
    };
  });

  return {
    kind: 'next',
    title: panel.title,
    note: panel.note,
    rows,
    empty: rows.length === 0 ? 'The queue is empty. Nothing is ranked to start next.' : null,
  };
}

function needsYouPanel(panel: Extract<PageOverviewPanel, { kind: 'needsYou' }>, input: OverviewInput): OverviewPanelView {
  const open = input.asks.filter(a => a.status === 'open');
  const proposals = input.pendingProposals.length;
  const total = open.length + proposals;

  const estimated = open.filter(a => typeof a.decisionCost === 'number' && a.decisionCost >= 0);
  const minutes = estimated.reduce((sum, a) => sum + (a.decisionCost ?? 0), 0);
  const unestimated = total - estimated.length;

  const figures: OverviewFigure[] = [
    {
      label: 'Open decisions',
      value: String(total),
      note: `${countLabel(open.length, 'questions')} filed by an agent and ${countLabel(proposals, 'proposals')} waiting on a yes`,
    },
  ];
  const gaps: OverviewGap[] = [];

  if (estimated.length > 0) {
    figures.push({
      label: 'Estimated minutes',
      value: `${minutes} min`,
      note: unestimated === 0
        ? `every open decision carries an estimate`
        : `a floor: ${countLabel(unestimated, 'items')} carry no estimate, so the real figure is higher`,
    });
  } else {
    gaps.push({
      label: 'Estimated minutes',
      why: `Nothing open carries a decisionCost estimate, and a queued proposal has no field for one, so the minutes cannot be computed rather than guessed.`,
    });
  }

  // A decision "blocks work" only if something records what it is holding up.
  // `ask.objectRefs` is that link. When no open ask carries one, the number is
  // not small, it is unknown, and the panel says so.
  const linked = open.filter(a => Array.isArray(a.objectRefs) && a.objectRefs.length > 0);
  if (linked.length > 0) {
    figures.push({
      label: 'Blocking work',
      value: String(linked.length),
      note: `decisions that name the record they are holding up${linked.length < open.length ? `; ${open.length - linked.length} name nothing, so this is a floor` : ''}`,
    });
  } else if (total > 0) {
    gaps.push({
      label: 'Blocking work',
      why: `No open decision names the record it is holding up (ask.objectRefs is empty on all ${open.length}), so how many block work is not measurable yet.`,
    });
  }

  return { kind: 'needsYou', title: panel.title, note: panel.note, href: panel.href, figures, gaps };
}

function economicsPanel(panel: Extract<PageOverviewPanel, { kind: 'economics' }>, input: OverviewInput): OverviewPanelView {
  const since = new Date(input.now.getTime() - panel.windowDays * DAY_MS);
  const pool = ofType(input.records, panel.objectType).filter((r) => {
    const at = stamp(r, panel.dateFields);
    return at !== null && at.at >= since;
  });
  const cents = (rows: OverviewRecord[]) => rows
    .map(r => numberAt(r, panel.costField))
    .filter((n): n is number => n !== null)
    .reduce((a, b) => a + b, 0);

  const spend = cents(pool);
  const accepted = pool.filter(r => panel.acceptedStatus.includes(r.status ?? ''));
  const wasted = pool.filter(r => panel.wasteStatus.includes(r.status ?? ''));
  const windowLabel = countLabel(panel.windowDays, 'days');

  const figures: OverviewFigure[] = [
    { label: `Spend, last ${windowLabel}`, value: formatMoney(spend), note: `${countLabel(pool.length, 'pieces of work')} carried cost in the window` },
    { label: 'Accepted changes', value: String(accepted.length), note: `status ${panel.acceptedStatus.join(' or ')}` },
  ];
  const gaps: OverviewGap[] = [];

  if (accepted.length > 0) {
    figures.push({
      label: 'Cost per accepted change',
      value: formatMoney(Math.round(spend / accepted.length)),
      note: 'all spend in the window over what was accepted, so failed attempts are charged to the change they were for',
    });
  } else {
    gaps.push({
      label: 'Cost per accepted change',
      why: `Nothing reached ${panel.acceptedStatus.join(' or ')} in the last ${windowLabel}, so there is no denominator. Spend without an accepted change is all waste, below.`,
    });
  }

  figures.push({
    label: 'Waste',
    value: formatMoney(cents(wasted)),
    note: `spent on ${countLabel(wasted.length, 'pieces of work')} that ended ${panel.wasteStatus.join(' or ')} and produced nothing accepted`,
  });

  return { kind: 'economics', title: panel.title, note: panel.note, figures, gaps };
}

function autonomyPanel(panel: Extract<PageOverviewPanel, { kind: 'autonomy' }>, input: OverviewInput): OverviewPanelView {
  const load = input.humanLoad;
  const work: OverviewFigure[] = [];
  const attention: OverviewFigure[] = [];
  const gaps: OverviewGap[] = [];
  const windowLabel = countLabel(panel.windowDays, 'days');

  if (!load || load.workItems === 0) {
    gaps.push({
      label: 'Work autonomy',
      why: `No work item was created in the last ${windowLabel}, so there is nothing to divide by.`,
    });
  } else {
    const unattended = percent(load.unattendedRate);
    work.push({
      label: 'Handled without a person',
      value: unattended ?? 'not measurable',
      note: `${load.workItems - load.needingDecision} of ${countLabel(load.workItems, 'work items')} in the last ${windowLabel} reached the end with nobody in the loop`,
    });
    const autoCompleted = percent(load.autonomousCompletionRate);
    if (autoCompleted !== null) {
      work.push({
        label: 'Executed under a trust rule',
        value: autoCompleted,
        note: `${load.autoExecuted} of ${countLabel(load.executed, 'executed actions')} needed no approval`,
      });
    }
  }

  if (load) {
    attention.push({
      label: 'Meaningful decisions required',
      value: String(load.interventions),
      note: `decisions a person actually took in the last ${windowLabel}`,
    });
    attention.push({
      label: 'Escalations approved unchanged',
      value: String(load.approvedClean),
      note: `asked for, then waved through without an edit. Named for what it is: the count of interruptions that changed nothing`,
    });
  }

  // Minutes of attention is only as good as the estimates on the decisions
  // that carry one. Action-run proposals carry none at all, so the figure is
  // always a floor and is labelled as one.
  const since = new Date(input.now.getTime() - panel.windowDays * DAY_MS);
  const decided = input.asks.filter(a => a.decidedAt !== null && a.decidedAt >= since);
  const estimated = decided.filter(a => typeof a.decisionCost === 'number');
  if (estimated.length > 0) {
    const minutes = estimated.reduce((sum, a) => sum + (a.decisionCost ?? 0), 0);
    attention.push({
      label: 'Attention per day',
      value: `${Math.round((minutes / panel.windowDays) * 10) / 10} min`,
      note: `a floor: only ${estimated.length} of ${countLabel(decided.length, 'decisions')} answered in the window carried a minutes estimate, and a proposal carries none`,
    });
  } else {
    gaps.push({
      label: 'Attention per day',
      why: `No decision answered in the last ${windowLabel} carried a minutes estimate, so the time a person spent is not recorded anywhere and will not be invented here.`,
    });
  }

  gaps.push({
    label: 'Unnecessary escalations',
    why: `Nothing records whether policy COULD have decided an item without asking. "Escalations approved unchanged" is the closest honest proxy and is reported above under its own name; it is not the same measure.`,
  });

  return { kind: 'autonomy', title: panel.title, note: panel.note, work, attention, gaps };
}

/**
 * Compute every panel the manifest declares, in the order it declares them.
 * Pure: the same input always yields the same page.
 * @param input - Records, decisions, the human-load fold, the viewer's last
 *   visit and the clock. See {@link OverviewInput}.
 */
export function assembleOverview(input: OverviewInput): FactoryOverview {
  const panels = input.panels.map((panel): OverviewPanelView => {
    switch (panel.kind) {
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
  return { panels, lastSeenAt: input.lastSeenAt };
}
