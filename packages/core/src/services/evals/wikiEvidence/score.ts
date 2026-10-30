/**
 * Grading the `wiki-evidence` eval (ADR 0012), without a model.
 *
 * - accuracy (0–1): the share of a question's `mustSay` facts the answer
 *   states, and 0 when it states a `mustNotSay` value as current. An old
 *   value in a sentence that calls it old, replaced or changed is the answer
 *   doing its job, not a contradiction.
 * - correct: accuracy 1.
 * - consistency (0–1): how much the cited documents overlap across the
 *   repetitions of one question (mean pairwise Jaccard of the `[src:…]`
 *   documents cited); an answer citing nothing overlaps with nothing.
 * - evidence: the share of the documents a grounded answer needs that it cites.
 * - cost per correct: everything spent over the answers that were correct.
 */
import type { EvidenceQuestion } from './dataset';
import type { EvidenceCondition, EvidenceLevel, QuestionRun } from './run';

export type Grade = { accuracy: number; correct: boolean; contradiction: boolean; cited: number[]; evidence: number };

const QUALIFIER = /outdated|out of date|out-of-date|superseded|replaced|no longer|previous(?:ly)?|old(?:er)?\b|used to|chang\w*|revis\w*|updat\w*|stale|was\s+(?:written|compiled|based)|2024|2025|not (?:current|correct|right|accurate)|incorrect|wrong|\bnot\b|rather than|instead of|still (?:says|lists|shows|has)/i;

/**
 * The documents an answer cites with `[src:<doc>…]` tokens.
 * @param answer - The answer.
 */
export function citedDocs(answer: string): number[] {
  return [...new Set([...answer.matchAll(/\[src:(\d+)(?:\.\d+)?\]/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * Whether the answer states a wrong value as current.
 * @param answer - The answer.
 * @param mustNotSay - The wrong values.
 */
export function contradicts(answer: string, mustNotSay: readonly RegExp[] = []): boolean {
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/);
  return mustNotSay.some(re => sentences.some(s => re.test(s) && !QUALIFIER.test(s)));
}

/**
 * Grade one answer.
 * @param q - The question.
 * @param answer - The answer.
 */
export function grade(q: EvidenceQuestion, answer: string): Grade {
  const said = q.mustSay.filter(re => re.test(answer)).length / q.mustSay.length;
  const contradiction = contradicts(answer, q.mustNotSay);
  const accuracy = contradiction ? 0 : said;
  const cited = citedDocs(answer);
  const evidence = q.evidence.filter(d => cited.includes(d)).length / q.evidence.length;
  return { accuracy, correct: accuracy === 1, contradiction, cited, evidence };
}

/**
 * Mean pairwise Jaccard of cited sets; 0 when there are fewer than two or nothing is cited.
 * @param sets - One cited set per repetition.
 */
export function jaccardConsistency(sets: ReadonlyArray<readonly number[]>): number {
  if (sets.length < 2) {
    return 0;
  }
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = new Set(sets[i]);
      const b = new Set(sets[j]);
      const union = new Set([...a, ...b]).size;
      sum += union === 0 ? 0 : [...a].filter(x => b.has(x)).length / union;
      pairs++;
    }
  }
  return sum / pairs;
}

export type Spread = { mean: number; sd: number; min: number; max: number };

/**
 * Mean, standard deviation, min and max.
 * @param xs - Values.
 */
export function spreadOf(xs: readonly number[]): Spread {
  if (xs.length === 0) {
    return { mean: 0, sd: 0, min: 0, max: 0 };
  }
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : 0;
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

export type CellSummary = {
  condition: EvidenceCondition;
  level: EvidenceLevel;
  kind: string;
  runs: number;
  crashed: number;
  /** Per repetition, then spread across repetitions. */
  accuracy: Spread;
  correct: Spread;
  contradictions: number;
  consistency: number;
  evidence: Spread;
  centsPerQuestion: Spread;
  centsPerCorrect: number;
  medianMs: number;
  toolCalls: number;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
}

/**
 * Summarise runs by condition, level and question kind.
 * @param questions - The questions.
 * @param runs - Every run.
 */
export function summarize(questions: readonly EvidenceQuestion[], runs: readonly QuestionRun[]): CellSummary[] {
  const byId = new Map(questions.map(q => [q.id, q]));
  const keys = [...new Set(runs.map(r => `${r.condition}|${r.level}|${r.kind}`))];
  const out: CellSummary[] = [];
  for (const key of keys) {
    const [condition, level, kind] = key.split('|') as [EvidenceCondition, EvidenceLevel, string];
    const cell = runs.filter(r => r.condition === condition && r.level === level && r.kind === kind);
    const ok = cell.filter(r => !r.crashed);
    const graded = ok.map(r => ({ r, g: grade(byId.get(r.questionId)!, r.answer) }));
    const reps = [...new Set(ok.map(r => r.rep))].sort((a, b) => a - b);
    const perRep = <T>(f: (xs: typeof graded) => T) => reps.map(rep => f(graded.filter(x => x.r.rep === rep)));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const consistency = mean([...new Set(ok.map(r => r.questionId))].map(id => jaccardConsistency(graded.filter(x => x.r.questionId === id).map(x => x.g.cited))));
    const correct = graded.filter(x => x.g.correct).length;
    const spent = ok.reduce((s, r) => s + r.cents, 0);
    out.push({
      condition,
      level,
      kind,
      runs: cell.length,
      crashed: cell.length - ok.length,
      accuracy: spreadOf(perRep(xs => mean(xs.map(x => x.g.accuracy)))),
      correct: spreadOf(perRep(xs => mean(xs.map(x => (x.g.correct ? 1 : 0))))),
      contradictions: graded.filter(x => x.g.contradiction).length,
      consistency,
      evidence: spreadOf(perRep(xs => mean(xs.map(x => x.g.evidence)))),
      centsPerQuestion: spreadOf(perRep(xs => mean(xs.map(x => x.r.cents)))),
      centsPerCorrect: correct ? spent / correct : Number.POSITIVE_INFINITY,
      medianMs: median(ok.map(r => r.totalMs)),
      toolCalls: mean(ok.map(r => r.calls.length)),
    });
  }
  const order = ['search', 'wiki', 'graph'];
  return out.sort((a, b) => a.level.localeCompare(b.level) || a.kind.localeCompare(b.kind) || order.indexOf(a.condition) - order.indexOf(b.condition));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sp = (s: Spread, f: (x: number) => string) => `${f(s.mean)} ±${f(s.sd).replace(/[%¢]/g, '')} (${f(s.min)}–${f(s.max)})`;

/**
 * The results as a markdown table.
 * @param cells - `summarize()`.
 */
export function resultsTable(cells: readonly CellSummary[]): string {
  const rows = cells.map(c => `| ${c.level} | ${c.kind} | ${c.condition} | ${c.runs}${c.crashed ? ` (${c.crashed} crashed)` : ''} | ${sp(c.accuracy, pct)} | ${sp(c.correct, pct)} | ${c.contradictions} | ${c.consistency.toFixed(2)} | ${pct(c.evidence.mean)} | ${c.centsPerQuestion.mean.toFixed(2)}¢ | ${Number.isFinite(c.centsPerCorrect) ? `${c.centsPerCorrect.toFixed(2)}¢` : '—'} | ${(c.medianMs / 1000).toFixed(1)} s | ${c.toolCalls.toFixed(1)} |`);
  return [
    '| Level | Kind | Condition | Runs | Accuracy | Correct | Stated stale as current | Citation consistency | Evidence cited | ¢/question | ¢/correct | Median time | Tool calls |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * Whether the evidence graph earns its place (ADR 0012's bar): on connected
 * questions it beats the wiki alone on accuracy and is no dearer per correct
 * answer; on simple ones it loses no more than 5 points of accuracy.
 * @param cells - `summarize()`.
 */
export function shipBar(cells: readonly CellSummary[]): Array<{ level: string; check: string; pass: boolean; detail: string }> {
  const out = [];
  for (const level of [...new Set(cells.map(c => c.level))]) {
    const get = (kind: string, condition: string) => cells.find(c => c.level === level && c.kind === kind && c.condition === condition);
    const cw = get('connected', 'wiki');
    const cg = get('connected', 'graph');
    const sw = get('simple', 'wiki');
    const sg = get('simple', 'graph');
    if (cw && cg) {
      out.push({ level, check: 'connected: graph more accurate than wiki', pass: cg.accuracy.mean > cw.accuracy.mean, detail: `${pct(cg.accuracy.mean)} vs ${pct(cw.accuracy.mean)}` });
      out.push({ level, check: 'connected: graph no dearer per correct answer', pass: cg.centsPerCorrect <= cw.centsPerCorrect, detail: `${cg.centsPerCorrect.toFixed(2)}¢ vs ${cw.centsPerCorrect.toFixed(2)}¢` });
    }
    if (sw && sg) {
      out.push({ level, check: 'simple: graph within 5 points of wiki', pass: sg.accuracy.mean >= sw.accuracy.mean - 0.05, detail: `${pct(sg.accuracy.mean)} vs ${pct(sw.accuracy.mean)}` });
    }
  }
  return out;
}
