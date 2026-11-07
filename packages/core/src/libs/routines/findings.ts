/**
 * WHAT VOCION FOUND IN A RECORDING — the analyst's reading of a taught
 * recording as one list of findings, each pinned to its moment: the steps in
 * order, the systems the work moved into, the rules said, the judgment calls
 * the specialist made, and the questions one recording cannot answer. The same
 * list is drawn while the analyst is still writing (`RoutineTeaching.found`)
 * and afterwards as the evidence behind the version it drafted. Pure and
 * client-safe.
 */

import type { Moment, RoutineFound, RoutineSpec } from './types';

export const FINDING_KINDS = ['step', 'system', 'rule', 'judgment', 'question'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Each kind as a person reads it: the group's heading and one mark's name. */
export const FINDING_LABEL: Record<FindingKind, { group: string; one: string }> = {
  step: { group: 'Steps', one: 'Step' },
  system: { group: 'Systems and sites', one: 'Moves to' },
  rule: { group: 'Rules', one: 'Rule' },
  judgment: { group: 'Judgment calls', one: 'Judgment call' },
  question: { group: 'Open questions', one: 'Question' },
};

export type RecordingFinding = {
  /** Stable within one reading: `step-3`, `rule-1`. */
  id: string;
  kind: FindingKind;
  text: string;
  /** The line under it: why a step happens, a site's address, why a question matters. */
  detail: string | null;
  at: Moment;
  /** A step's number. */
  n?: number;
};

type Readable = Partial<Pick<RoutineSpec, 'steps' | 'rules' | 'questions' | 'escalations' | 'systems' | 'judgments' | 'sites'>>;

/**
 * A spec, or what the analyst has written of one so far, as findings: grouped by kind in the
 * order above, each group in the order it was written. A spec drafted before judgment calls and
 * sites were read gives its escalation points as judgment calls and its hosts as systems.
 * @param spec - The spec or `RoutineFound`.
 */
export function findingsOf(spec: Readable | RoutineFound | null | undefined): RecordingFinding[] {
  if (!spec) {
    return [];
  }
  const s = spec as Readable;
  const out: RecordingFinding[] = [];
  for (const st of s.steps ?? []) {
    out.push({ id: `step-${st.n}`, kind: 'step', text: st.text, detail: st.why ?? null, at: st.at, n: st.n });
  }
  if (s.sites) {
    s.sites.forEach((x, i) => out.push({ id: `system-${i + 1}`, kind: 'system', text: x.name, detail: x.url, at: x.at }));
  } else {
    (s.systems ?? []).forEach((h, i) => out.push({ id: `system-${i + 1}`, kind: 'system', text: h, detail: null, at: null }));
  }
  (s.rules ?? []).forEach((r, i) => out.push({ id: `rule-${i + 1}`, kind: 'rule', text: r.text, detail: null, at: r.at }));
  if (s.judgments) {
    s.judgments.forEach((j, i) => out.push({ id: `judgment-${i + 1}`, kind: 'judgment', text: j.text, detail: null, at: j.at }));
  } else {
    (s.escalations ?? []).forEach((e, i) => out.push({ id: `judgment-${i + 1}`, kind: 'judgment', text: e.when, detail: e.ask ? `Asks the expert: ${e.ask}` : null, at: e.at }));
  }
  (s.questions ?? []).forEach(q => out.push({ id: `question-${q.id}`, kind: 'question', text: q.question, detail: q.why ?? null, at: q.at }));
  return out;
}

/** One finding as a mark on a recording's track. */
export type TimelineMark = { id: string; kind: string; at: number; label: string };

/**
 * The findings that have a moment, as marks on the recording's track, in time order. A moment past
 * the recording's end (a misread clock) is dropped rather than pinned to the edge.
 * @param findings - The findings.
 * @param durationSec - The recording's length, when known.
 */
export function findingMarks(findings: RecordingFinding[], durationSec: number | null): TimelineMark[] {
  return findings
    .filter((f): f is RecordingFinding & { at: number } => f.at !== null && Number.isFinite(f.at) && f.at >= 0 && (durationSec === null || f.at <= durationSec + 1))
    .map(f => ({ id: f.id, kind: f.kind, at: f.at, label: `${f.kind === 'step' && f.n ? `Step ${f.n}` : FINDING_LABEL[f.kind].one}: ${f.text}` }))
    .sort((a, b) => a.at - b.at);
}

/**
 * How many of each kind, for a line like "9 steps · 3 rules".
 * @param findings - The findings.
 */
export function findingCounts(findings: RecordingFinding[]): Partial<Record<FindingKind, number>> {
  const out: Partial<Record<FindingKind, number>> = {};
  for (const f of findings) {
    out[f.kind] = (out[f.kind] ?? 0) + 1;
  }
  return out;
}
