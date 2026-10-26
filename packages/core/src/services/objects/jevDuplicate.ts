/**
 * JEV JUDGES DUPLICATES FIRST (ADR 0007). A workspace that sets
 * `defaults.jev.duplicateCheck` and has a Jev key gets a cheaper, faster
 * first read of "is this new record one we already have?":
 *
 *   1. Code: the same title and compared text as a shortlisted record is a
 *      duplicate, and nothing is asked.
 *   2. Jev: one yes/no per shortlisted record, in one call. One record at or
 *      above the type's bar is the duplicate; every record at or below
 *      `JEV_NO_BAR` means none is.
 *   3. Anything else — unsure, two at the bar, an error, a timeout, the
 *      breaker open — goes to the classifier, exactly as without Jev.
 *
 * Whatever decides, the link is written the way it always was (done for you,
 * with Undo, on the trust ladder). Every judge asked leaves one row in
 * `record_duplicate_check`. Jev reads only the titles and compared fields,
 * shortened, and whether each existing record is open; no ids, no people.
 */
import type { DuplicateCandidate, DuplicateJudgement } from './duplicateCheck';
import type { KeyScope } from '@/services/routing/jevKey';
import { createHash } from 'node:crypto';
import { versionOf } from '@/services/routing/jev';

/** At or below this for every candidate, Jev's "none is a duplicate" stands. */
export const JEV_NO_BAR = 0.3;
const TITLE_CHARS = 200;
const NEW_TEXT_CHARS = 1_000;
const OLD_TEXT_CHARS = 400;
const QUESTION = 'Is the new {kind} in state the same ask as this existing record, so that doing one would satisfy the other?';
const CRITERIA = {
  true: 'The same outcome for the same people, however it is worded; a later report of the same fault is the same.',
  false: 'It asks for more, for less, for a different surface or a different situation, even when it shares words.',
};

/**
 * Which wording and bands the duplicate question is (ADR 0006, health): it
 * changes whenever the question, its criteria, what is sent or the no-band do.
 */
export const DUPLICATE_QUESTION_VERSION = versionOf('duplicate', { QUESTION, CRITERIA, JEV_NO_BAR, TITLE_CHARS, NEW_TEXT_CHARS, OLD_TEXT_CHARS });

/** The Jev key a workspace's duplicate check spends, when it has opted in. */
export type JevGate = { key: string; scope: KeyScope };

/**
 * The key, when this workspace lets Jev judge duplicates and one resolves;
 * null otherwise (and on any error reading either).
 * @param orgId - The workspace.
 */
export async function jevDuplicateGate(orgId: string): Promise<JevGate | null> {
  try {
    const { eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { projectSchema } = await import('@/models/Schema');
    const [row] = await db.select({ jev: projectSchema.jev }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    if (row?.jev?.duplicateCheck !== true) {
      return null;
    }
    const { resolveJevKey } = await import('@/services/routing/jevKey');
    return await resolveJevKey(orgId);
  } catch {
    return null;
  }
}

/**
 * Text folded for an exact comparison: case, accents, punctuation and spacing
 * do not count. Pure.
 * @param s - The text.
 */
export function foldText(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * The shortlisted record with the same title and compared text, or null. Pure.
 * @param record - The new record.
 * @param record.title - Its title.
 * @param record.text - Its compared fields.
 * @param shortlist - The existing records.
 */
export function exactDuplicate(record: { title: string; text: string }, shortlist: readonly DuplicateCandidate[]): DuplicateCandidate | null {
  const title = foldText(record.title);
  const text = foldText(record.text);
  if (!title) {
    return null;
  }
  return shortlist.find(c => foldText(c.title) === title && foldText(c.text) === text) ?? null;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What Jev is asked: the new record as state, one yes/no per existing record,
 * keyed `c0`, `c1`, … in shortlist order. Only what the judgement needs. Pure.
 * @param label - The type's label ("Request").
 * @param record - The new record.
 * @param record.title - Its title.
 * @param record.text - Its compared fields.
 * @param shortlist - The existing records.
 */
export function duplicateQuestions(label: string, record: { title: string; text: string }, shortlist: readonly DuplicateCandidate[]) {
  const kind = label.toLowerCase();
  return {
    state: { new_record: { kind, title: clip(record.title, TITLE_CHARS), details: clip(record.text, NEW_TEXT_CHARS) } },
    questions: Object.fromEntries(shortlist.map((c, i) => [`c${i}`, {
      instructions: {
        existing_record: { title: clip(c.title, TITLE_CHARS), details: clip(c.text, OLD_TEXT_CHARS), status: c.settled ? 'closed' : 'open' },
        question: QUESTION.replace('{kind}', kind),
      },
      criteria: CRITERIA,
    }])),
  };
}

/** What Jev's probabilities come to. */
export type JevRead
  = | { verdict: 'duplicate'; match: DuplicateCandidate; p: number }
    | { verdict: 'not_duplicate'; p: number }
    | { verdict: 'unsure'; p: number | null; why: string };

/**
 * Code decides on Jev's probabilities. Pure.
 * @param probabilities - Key (`c0`…) → p.
 * @param shortlist - The records asked about, in key order.
 * @param bar - The type's bar for a duplicate.
 */
export function readJevDuplicate(probabilities: Record<string, number>, shortlist: readonly DuplicateCandidate[], bar: number): JevRead {
  const ps = shortlist.map((c, i) => ({ c, p: probabilities[`c${i}`] }));
  const answered = ps.filter((x): x is { c: DuplicateCandidate; p: number } => typeof x.p === 'number');
  const top = answered.reduce<{ c: DuplicateCandidate; p: number } | null>((a, b) => (!a || b.p > a.p ? b : a), null);
  const atBar = answered.filter(x => x.p >= bar);
  if (atBar.length === 1 && top) {
    return { verdict: 'duplicate', match: top.c, p: top.p };
  }
  if (atBar.length > 1) {
    return { verdict: 'unsure', p: top?.p ?? null, why: 'more than one at the bar' };
  }
  if (answered.length < shortlist.length) {
    return { verdict: 'unsure', p: top?.p ?? null, why: 'not every record answered' };
  }
  if (!top || top.p <= JEV_NO_BAR) {
    return { verdict: 'not_duplicate', p: 1 - (top?.p ?? 0) };
  }
  return { verdict: 'unsure', p: top.p, why: 'unsure' };
}

/**
 * A SHA-256 of what a judge was asked, so two checks of the same thing can be
 * matched without keeping the text. Pure.
 * @param v - The question.
 */
export function inputsHash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex');
}

/** One row of `record_duplicate_check`, before it is written. */
export type DuplicateCheckRow = {
  judge: 'exact' | 'jev' | 'model';
  verdict: 'duplicate' | 'failed' | 'not_duplicate' | 'unsure';
  duplicateOf: number | null;
  confidence: number | null;
  inputsHash: string;
  latencyMs: number | null;
  model: string | null;
  keyScope?: KeyScope | null;
  provider?: string | null;
  inputTokens?: number | null;
  fallback?: string | null;
  /** Jev rows: which wording was asked. */
  questionVersion?: string | null;
};

/**
 * Keep the check's rows. Never throws: a row that cannot be written is not a
 * reason for the check to fail.
 * @param orgId - The workspace.
 * @param record - The record checked.
 * @param record.objectType - Its type slug.
 * @param record.objectId - Its id.
 * @param candidates - How many records were compared.
 * @param rows - One per judge asked.
 * @param linkedBy - The judge whose verdict wrote the link, if one did.
 */
export async function noteDuplicateChecks(orgId: string, record: { objectType: string; objectId: number }, candidates: number, rows: readonly DuplicateCheckRow[], linkedBy: DuplicateCheckRow['judge'] | null): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  try {
    const { db } = await import('@/libs/DB');
    const { recordDuplicateCheckSchema } = await import('@/models/Schema');
    await db.insert(recordDuplicateCheckSchema).values(rows.map(r => ({
      orgId,
      objectType: record.objectType,
      objectId: record.objectId,
      candidates,
      judge: r.judge,
      verdict: r.verdict,
      duplicateOf: r.duplicateOf,
      confidence: r.confidence,
      inputsHash: r.inputsHash,
      latencyMs: r.latencyMs === null ? null : Math.round(r.latencyMs),
      model: r.model,
      keyScope: r.keyScope ?? null,
      provider: r.provider ?? null,
      inputTokens: r.inputTokens ?? null,
      fallback: r.fallback ?? null,
      questionVersion: r.questionVersion ?? null,
      linked: linkedBy === r.judge,
    })));
  } catch (err) {
    console.warn('duplicate check: could not keep its record', { orgId, message: (err as Error).message });
  }
}

/** Seams for tests. */
export type JevDuplicateDeps = { fetch?: typeof fetch; now?: () => number };

/**
 * The cascade: exact match, then Jev, then `fallback` (the classifier). The
 * verdict is shaped like the classifier's, so the caller links exactly as it
 * did; `rows` are what to keep once the caller knows whether it linked.
 * @param input - The check.
 * @param input.orgId - The workspace.
 * @param input.gate - The key.
 * @param input.label - The type's label.
 * @param input.record - The new record.
 * @param input.record.id
 * @param input.record.title
 * @param input.record.text
 * @param input.shortlist - The existing records.
 * @param input.bar - The type's bar.
 * @param fallback - The classifier, as the check calls it without Jev.
 * @param deps - Seams for tests.
 */
export async function judgeWithJev(
  input: { orgId: string; gate: JevGate; label: string; record: { id: number; title: string; text: string }; shortlist: readonly DuplicateCandidate[]; bar: number },
  fallback: () => Promise<DuplicateJudgement | null>,
  deps: JevDuplicateDeps = {},
): Promise<{ verdict: DuplicateJudgement | null; rows: DuplicateCheckRow[]; by: DuplicateCheckRow['judge'] }> {
  const now = deps.now ?? Date.now;
  const exact = exactDuplicate(input.record, input.shortlist);
  if (exact) {
    return {
      verdict: { duplicateOf: exact.id, confidence: 1, reason: 'Same title and details.' },
      rows: [{ judge: 'exact', verdict: 'duplicate', duplicateOf: exact.id, confidence: 1, inputsHash: inputsHash([input.record.title, input.record.text]), latencyMs: 0, model: null }],
      by: 'exact',
    };
  }
  const { askYesNo, jevSettings } = await import('@/services/routing/jev');
  const { jevBreakerOpen, noteJevOutcome } = await import('@/services/routing/agentRoute');
  const q = duplicateQuestions(input.label, input.record, input.shortlist);
  const hash = inputsHash(q);
  const settings = jevSettings();
  const rows: DuplicateCheckRow[] = [];
  let why: string;
  if (jevBreakerOpen(input.orgId, now())) {
    why = 'breaker open';
    rows.push({ judge: 'jev', verdict: 'failed', duplicateOf: null, confidence: null, inputsHash: hash, latencyMs: null, model: null, keyScope: input.gate.scope, fallback: why, questionVersion: DUPLICATE_QUESTION_VERSION });
  } else {
    const res = await askYesNo(input.gate.key, q, settings, deps);
    noteJevOutcome(input.orgId, !('failed' in res), now());
    if ('failed' in res) {
      why = res.kind;
      rows.push({ judge: 'jev', verdict: 'failed', duplicateOf: null, confidence: null, inputsHash: hash, latencyMs: res.latencyMs, model: null, keyScope: input.gate.scope, questionVersion: DUPLICATE_QUESTION_VERSION, fallback: res.reason });
    } else {
      const read = readJevDuplicate(res.probabilities, input.shortlist, input.bar);
      const base = { judge: 'jev' as const, questionVersion: DUPLICATE_QUESTION_VERSION, inputsHash: hash, latencyMs: res.latencyMs, model: res.model ?? settings.model, keyScope: input.gate.scope, provider: res.provider, inputTokens: res.inputTokens };
      if (read.verdict === 'duplicate') {
        rows.push({ ...base, verdict: 'duplicate', duplicateOf: read.match.id, confidence: read.p });
        return { verdict: { duplicateOf: read.match.id, confidence: read.p, reason: `Jev read them as the same ask (${Math.round(read.p * 100)}% sure).` }, rows, by: 'jev' };
      }
      if (read.verdict === 'not_duplicate') {
        rows.push({ ...base, verdict: 'not_duplicate', duplicateOf: null, confidence: read.p });
        return { verdict: { duplicateOf: null, confidence: read.p, reason: 'Jev read none of them as the same ask.' }, rows, by: 'jev' };
      }
      why = read.why;
      rows.push({ ...base, verdict: 'unsure', duplicateOf: null, confidence: read.p, fallback: why });
    }
  }
  const started = now();
  const verdict = await fallback();
  rows.push({
    judge: 'model',
    verdict: !verdict ? 'failed' : verdict.duplicateOf === null ? 'not_duplicate' : verdict.confidence >= input.bar ? 'duplicate' : 'unsure',
    duplicateOf: verdict?.duplicateOf ?? null,
    confidence: verdict?.confidence ?? null,
    inputsHash: hash,
    latencyMs: now() - started,
    model: 'classifier',
    fallback: `jev: ${why}`,
  });
  return { verdict, rows, by: 'model' };
}
