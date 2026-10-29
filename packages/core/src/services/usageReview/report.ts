/**
 * The daily usage review, written up: the briefing a workspace reads, built in
 * code from the facts and the judgements. Pure — no database, no model.
 *
 * Outcome first: did people get where they wanted, how often they had to ask
 * again, what got in the way most, and the three threads most worth a look.
 * Every claim carries its thread: each friction theme lists the threads that
 * showed it, each table row starts with a link to its thread, and the numbers
 * are code's, never a model's.
 *
 * In metadata mode nothing a person wrote reaches the report: threads are
 * named by number and agent, outcomes are read from structure, and the themes
 * are the ones the numbers show.
 */

import type { FrictionTheme, Outcome, ThreadFacts } from './facts';
import type { CapabilityKind, ThreadJudgement } from './judge';
import type { ReadModeDecision } from './privacy';
import type { PublishBriefingInput } from '@/services/briefings/agentInput';
import { THEME_LABEL } from './facts';
import { READ_MODE_LABEL, READ_MODE_WHY_LABEL } from './privacy';

/** The briefing's name; the publisher adds the date. */
export const USAGE_REVIEW_TITLE = 'Daily usage review';

/** The detail tables, by title — the roll-up reads them back by these. */
export const TABLE = {
  worthALook: 'Threads worth a look',
  effort: 'Effort mismatches',
  missing: 'Missing connectors and skills',
  fixes: 'Suggested fixes',
  approvals: 'Approvals decided',
  mode: 'How this review read the workspace',
} as const;

/** The metric keys, read back by the roll-up. */
export const METRIC = {
  threads: 'usage_threads',
  outcome: 'usage_outcome_rate',
  reask: 'usage_reask_rate',
  approvals: 'usage_approvals',
  agreement: 'usage_approval_agreement',
} as const;

const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = {
  reached: 'Got there',
  partial: 'Partly',
  not_reached: 'Did not get there',
  unclear: 'Unclear',
};

const LEVEL_LABEL: Readonly<Record<string, string>> = { quick: 'Quick', standard: 'Standard', deep: 'Deep' };

/** One thread or approval, read and (in content mode, when the cap allowed) judged. */
export type ItemResult = {
  ref: string;
  kind: 'thread' | 'approval';
  /** Where a person checks it: the thread, or the decided item. */
  href: string;
  /** How the report names it. Never the person's words in metadata mode. */
  label: string;
  agentSlug: string | null;
  agentName: string | null;
  facts: ThreadFacts | null;
  /** For an approval: what the person decided, and whether it matched the recommendation. */
  approval?: { decision: string; recommended: string | null; agreed: boolean | null; waitedMinutes: number | null; key: string };
  outcome: Outcome;
  /** Who read the outcome: the judge, or the thread's structure. */
  outcomeBy: 'judge' | 'structure';
  themes: FrictionTheme[];
  judgement: ThreadJudgement | null;
  friction: number;
};

/** A capability people needed, gathered across threads. */
export type MissingCapability = { kind: CapabilityKind; name: string; why: string; refs: string[] };

/** A fix the review filed as a proposal, or could not. */
export type FiledFix = { headline: string; kind: string; runId: number | null; why?: string };

export type UsageReport = {
  orgId: string;
  workspaceName: string;
  window: { since: string; until: string };
  mode: ReadModeDecision;
  threads: { active: number; read: number; judged: number; sampled: boolean };
  approvals: number;
  /** Of the items with a readable outcome, how many got there. */
  outcome: { reached: number; readable: number; rate: number | null };
  reasks: { threads: number; rate: number | null };
  themes: Array<{ theme: FrictionTheme; label: string; count: number; refs: string[] }>;
  effort: Array<{ ref: string; ranAt: string; needed: string; why: string }>;
  missing: MissingCapability[];
  worthALook: string[];
  fixes: FiledFix[];
  judgeCents: number;
  /** Why fewer were judged than read, when they were. */
  judgeNote: string | null;
};

function pct(n: number, of: number): number | null {
  return of > 0 ? Math.round((n / of) * 100) : null;
}

/**
 * The numbers and lists the report is made of. Pure.
 * @param input - What the review read.
 * @param input.orgId - The workspace.
 * @param input.workspaceName - Its name.
 * @param input.window - The day read.
 * @param input.window.since - Start, inclusive.
 * @param input.window.until - End, exclusive.
 * @param input.mode - How the Org was read.
 * @param input.items - Every item read.
 * @param input.activeThreads - Threads active in the window, before any cap.
 * @param input.judgeCents - What the judge spent.
 * @param input.judgeNote - Why fewer were judged than read.
 */
export function summarize(input: {
  orgId: string;
  workspaceName: string;
  window: { since: Date; until: Date };
  mode: ReadModeDecision;
  items: readonly ItemResult[];
  activeThreads: number;
  judgeCents: number;
  judgeNote: string | null;
}): UsageReport {
  const threads = input.items.filter(i => i.kind === 'thread');
  const readable = input.items.filter(i => i.outcome !== 'unclear');
  const reached = readable.filter(i => i.outcome === 'reached').length;
  const reasked = threads.filter(t => (t.facts?.reasks.length ?? 0) > 0).length;

  const byTheme = new Map<FrictionTheme, string[]>();
  for (const i of input.items) {
    for (const t of new Set(i.themes)) {
      byTheme.set(t, [...(byTheme.get(t) ?? []), i.ref]);
    }
  }
  const themes = [...byTheme.entries()]
    .map(([theme, refs]) => ({ theme, label: THEME_LABEL[theme], count: refs.length, refs }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const effort: UsageReport['effort'] = [];
  for (const t of threads) {
    const j = t.judgement;
    if (j && j.effort_fit !== 'right' && j.effort_needed) {
      const ranAt = [...new Set((t.facts?.turns ?? []).map(x => x.effort).filter(Boolean))].map(l => LEVEL_LABEL[l!]).join(', ') || 'unknown';
      effort.push({ ref: t.ref, ranAt, needed: LEVEL_LABEL[j.effort_needed] ?? j.effort_needed, why: j.effort_fit === 'too_low' ? 'needed more than it got' : 'spent more than it needed' });
      continue;
    }
    if (!j) {
      // Structure alone: the strongest effort signal the numbers show.
      const s = t.facts?.effortSignals.find(x => x.suggests !== x.level);
      if (s) {
        effort.push({ ref: t.ref, ranAt: LEVEL_LABEL[s.level] ?? s.level, needed: LEVEL_LABEL[s.suggests] ?? s.suggests, why: s.signal === 'reasked_after_quick' ? 'the person asked again after a Quick answer' : s.signal === 'hit_ceiling' ? 'the turn ran into its time or spend ceiling' : 'a light request ran at Deep' });
      }
    }
  }

  const missing = new Map<string, MissingCapability>();
  for (const i of input.items) {
    for (const m of i.judgement?.missing ?? []) {
      const key = `${m.kind}:${m.name.trim().toLowerCase()}`;
      const had = missing.get(key);
      if (had) {
        had.refs.push(i.ref);
      } else {
        missing.set(key, { kind: m.kind, name: m.name.trim(), why: m.why, refs: [i.ref] });
      }
    }
  }

  const worthALook = [...input.items]
    .filter(i => i.friction > 0 || i.outcome === 'not_reached' || i.outcome === 'partial')
    .sort((a, b) => b.friction - a.friction || outcomeWeight(b.outcome) - outcomeWeight(a.outcome))
    .slice(0, 3)
    .map(i => i.ref);

  return {
    orgId: input.orgId,
    workspaceName: input.workspaceName,
    window: { since: input.window.since.toISOString(), until: input.window.until.toISOString() },
    mode: input.mode,
    threads: { active: input.activeThreads, read: threads.length, judged: input.items.filter(i => i.judgement).length, sampled: input.judgeNote !== null },
    approvals: input.items.length - threads.length,
    outcome: { reached, readable: readable.length, rate: pct(reached, readable.length) },
    reasks: { threads: reasked, rate: pct(reasked, threads.length) },
    themes,
    effort,
    missing: [...missing.values()].sort((a, b) => b.refs.length - a.refs.length),
    worthALook,
    fixes: [],
    judgeCents: Math.round(input.judgeCents * 100) / 100,
    judgeNote: input.judgeNote,
  };
}

function outcomeWeight(o: Outcome): number {
  return o === 'not_reached' ? 3 : o === 'partial' ? 2 : o === 'unclear' ? 1 : 0;
}

/**
 * The briefing a workspace reads. Pure.
 * @param report - The summary.
 * @param items - The items, by ref, for each row's link and words.
 */
export function briefingInput(report: UsageReport, items: ReadonlyMap<string, ItemResult>): PublishBriefingInput {
  const link = (ref: string) => {
    const i = items.get(ref);
    return i ? `[${i.label}](${i.href})` : ref;
  };
  const evidence = (refs: readonly string[]) => refs.slice(0, 6).flatMap((ref) => {
    const i = items.get(ref);
    return i ? [{ kind: i.kind === 'thread' ? 'conversation' : 'inbox', id: ref, label: i.label, href: i.href }] : [];
  });
  const content = report.mode.mode === 'content';

  const metrics: PublishBriefingInput['metrics'] = [
    { key: METRIC.threads, label: 'Chat threads read', value: report.threads.read, unit: 'count', provenance: 'observed', evidence: [] },
    report.outcome.rate === null
      ? { key: METRIC.outcome, label: 'Got where they wanted', value: null, provenance: 'observed', unavailable: { headline: 'Outcome could not be read', detail: content ? 'No item had a readable outcome.' : 'Read as metadata only: an outcome is read from a thread\'s structure, and no thread showed one.' }, evidence: [] }
      : { key: METRIC.outcome, label: 'Got where they wanted', value: report.outcome.rate, unit: 'pct', provenance: content ? 'agent-reported' : 'observed', evidence: [] },
    ...(report.reasks.rate === null ? [] : [{ key: METRIC.reask, label: 'Had to ask again', value: report.reasks.rate, unit: 'pct', provenance: 'observed' as const, evidence: [] }]),
    { key: METRIC.approvals, label: 'Approvals decided', value: report.approvals, unit: 'count', provenance: 'observed', evidence: [] },
  ];
  const decided = [...items.values()].filter(i => i.approval && i.approval.agreed !== null);
  if (decided.length > 0) {
    metrics.push({ key: METRIC.agreement, label: 'Approvals that matched the recommendation', value: pct(decided.filter(i => i.approval!.agreed).length, decided.length)!, unit: 'pct', provenance: 'observed', evidence: [] });
  }

  const exceptions: PublishBriefingInput['exceptions'] = report.themes.slice(0, 3).map((t) => {
    const example = t.refs.map(r => items.get(r)?.judgement?.better).find(b => b && b.toLowerCase() !== 'nothing');
    return {
      key: `theme-${t.theme}`,
      label: `${t.label} · ${t.count} ${t.count === 1 ? 'thread' : 'threads'}`,
      why: example ? `For example: ${example}` : `Seen in ${t.refs.slice(0, 3).map(r => items.get(r)?.label ?? r).join(', ')}${t.refs.length > 3 ? ` and ${t.refs.length - 3} more` : ''}.`,
      severity: 'risk',
      evidence: evidence(t.refs),
    };
  });

  const tables: PublishBriefingInput['detail'] = [];
  if (report.worthALook.length > 0) {
    tables.push({
      title: TABLE.worthALook,
      columns: ['Thread', 'Outcome', 'What would have been better', 'Turns · time · spend'],
      rows: report.worthALook.map((ref) => {
        const i = items.get(ref)!;
        const f = i.facts;
        const better = i.judgement?.better ?? structuralBetter(i);
        return [link(ref), `${OUTCOME_LABEL[i.outcome]}${i.outcomeBy === 'structure' ? ' (from structure)' : ''}`, better, f ? `${f.turns.length} · ${f.workSeconds}s · $${(f.cents / 100).toFixed(2)}${f.reasks.length ? ` · asked again ${f.reasks.length}×` : ''}` : approvalLine(i)];
      }),
    });
  }
  if (report.effort.length > 0) {
    tables.push({ title: TABLE.effort, columns: ['Thread', 'Ran at', 'Needed', 'Why'], rows: report.effort.slice(0, 8).map(e => [link(e.ref), e.ranAt, e.needed, e.why]) });
  }
  if (report.missing.length > 0) {
    tables.push({ title: TABLE.missing, columns: ['Kind', 'What', 'Threads', 'What it would have done'], rows: report.missing.slice(0, 8).map(m => [m.kind, m.name, m.refs.map(link).join(', '), m.why]) });
  }
  const approvals = [...items.values()].filter(i => i.approval && (i.approval.agreed === false || i.outcome !== 'reached'));
  if (approvals.length > 0) {
    tables.push({ title: TABLE.approvals, columns: ['Item', 'Decided', 'Recommended', 'Waited'], rows: approvals.slice(0, 8).map(i => [link(i.ref), i.approval!.decision, i.approval!.recommended ?? '—', i.approval!.waitedMinutes === null ? '—' : `${i.approval!.waitedMinutes} min`]) });
  }
  tables.push({
    title: TABLE.mode,
    columns: ['Read as', 'Because of', 'Judged'],
    rows: [[READ_MODE_LABEL[report.mode.mode], READ_MODE_WHY_LABEL[report.mode.why], judgedLine(report)]],
    note: content
      ? 'A model read each judged thread and answered in typed fields; every count above was made in code.'
      : 'No model read any chat content. Outcomes come from how each thread ended and how it was rated; re-asks from comparing a person\'s own messages in code.',
  });

  const summary = report.threads.read + report.approvals === 0
    ? `Nothing to read in ${report.workspaceName} yesterday.`
    : `${report.threads.read} ${report.threads.read === 1 ? 'thread' : 'threads'} and ${report.approvals} ${report.approvals === 1 ? 'approval' : 'approvals'}: ${report.outcome.rate === null ? 'outcomes could not be read' : `${report.outcome.reached} of ${report.outcome.readable} with a readable outcome got there`}${report.reasks.threads > 0 ? `, and people asked again in ${report.reasks.threads}` : ''}.`;

  return {
    title: USAGE_REVIEW_TITLE,
    summary,
    metrics,
    narratives: {},
    whyNow: {},
    incidents: {},
    criticalPath: [],
    exceptions,
    detail: tables,
  };
}

/**
 * One line for the "Judged" column.
 * @param r - The summary.
 */
function judgedLine(r: UsageReport): string {
  if (r.mode.mode === 'metadata') {
    return 'none — metadata only';
  }
  const base = `${r.threads.judged} of ${r.threads.read + r.approvals}`;
  return r.judgeNote ? `${base} — ${r.judgeNote}` : base;
}

function approvalLine(i: ItemResult): string {
  const a = i.approval;
  return a ? `${a.decision}${a.waitedMinutes === null ? '' : ` after ${a.waitedMinutes} min`}` : '—';
}

/**
 * What the numbers alone say would have been better, for an item nobody judged.
 * @param i - The item.
 */
function structuralBetter(i: ItemResult): string {
  const f = i.facts;
  if (!f) {
    return i.approval?.agreed === false ? 'The recommendation was overruled.' : '—';
  }
  if (f.failedTurns > 0) {
    return `${f.failedTurns} ${f.failedTurns === 1 ? 'turn' : 'turns'} failed or stopped short.`;
  }
  if (f.toolFailures > 0) {
    return `${f.toolFailures} tool ${f.toolFailures === 1 ? 'call' : 'calls'} failed.`;
  }
  if (f.reasks.length > 0) {
    return `The person asked again ${f.reasks.length}×.`;
  }
  return 'Not judged.';
}
