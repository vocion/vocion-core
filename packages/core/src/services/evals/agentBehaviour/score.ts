/**
 * Grading the `agent-behaviour` eval (ADR 0009, ADR 0010). Pure: a run is
 * graded from what it did, with no model call. The gate is the one the
 * switch to `core` loading must pass. With repeats (`rep`), every figure is
 * also read per repetition, and its spread reported, because one run of a
 * few dozen cases moves by more than the differences being judged.
 */
import type { EvalCase } from './dataset';
import { claimsSave, FAILED_TOOLS_THRESHOLD, isRefusal, SAVE_TOOLS } from '../live/turnSignals';

/** What one case did in one mode and level. */
export type CaseRun = {
  caseId: string;
  agent: string;
  kind: EvalCase['kind'];
  mode: 'history' | 'core' | 'all';
  level: 'quick' | 'standard';
  /** Which repetition this run was, from 0. */
  rep?: number;
  answer: string;
  calls: Array<{ tool: string; input: Record<string, unknown>; error: boolean }>;
  searches: number;
  unknownTools: number;
  toolErrors: number;
  loaded: number;
  deferred: number;
  overBudget: boolean;
  /** Time to the first streamed token of the turn's first model call. */
  firstTokenMs: number;
  totalMs: number;
  cents: number;
  inputTokens: number;
  cacheReadTokens: number;
  /** The first call read its prefix from the cache. */
  warm: boolean;
  /** The run threw (provider error): not graded, reported. */
  crashed?: string;
};

export { isRefusal };

/**
 * Whether the case's tool was used: an expected tool called without an
 * error, and for a write, naming the expected action.
 * @param c - The case.
 * @param run - What it did.
 */
export function usedExpectedTool(c: Pick<EvalCase, 'expectTools' | 'expectActionPrefix'>, run: Pick<CaseRun, 'calls'>): boolean {
  return run.calls.some(call => !call.error
    && c.expectTools.includes(call.tool)
    && (!c.expectActionPrefix || String(call.input.action_id ?? call.input.actionId ?? '').startsWith(c.expectActionPrefix)));
}

export type CaseGrade = {
  /** Null when the case needs no tool. */
  aware: boolean | null;
  falseRefusal: boolean;
  /** Null when the case checks no arguments, or the tool was never called. */
  argsOk: boolean | null;
  /** Null when the case checks no grounding. */
  grounded: boolean | null;
  /** Said something was kept, and nothing was. */
  madeUpSave: boolean;
};

/**
 * Grade one run. Every case is something the agent can do, so any refusal
 * that comes without the work is a false one.
 * @param c - The case.
 * @param run - What it did.
 */
export function gradeCase(c: EvalCase, run: CaseRun): CaseGrade {
  const aware = c.expectTools.length ? usedExpectedTool(c, run) : null;
  const tried = run.calls.filter(call => !call.error && c.expectTools.includes(call.tool));
  const argsOk = c.args && tried.length ? tried.some(call => safely(() => c.args!.ok(call))) : null;
  const grounded = c.grounding
    ? c.grounding.mustSay.every(re => re.test(run.answer)) && !(c.grounding.mustNotSay ?? []).some(re => re.test(run.answer))
    : null;
  const saved = run.calls.some(call => !call.error && SAVE_TOOLS.has(call.tool));
  return { aware, falseRefusal: aware !== true && isRefusal(run.answer), argsOk, grounded, madeUpSave: claimsSave(run.answer) && !saved };
}

function safely(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

export type ModeSummary = {
  mode: CaseRun['mode'];
  level: CaseRun['level'];
  runs: number;
  crashed: number;
  awareness: number;
  falseRefusals: number;
  /** Share of argument-checked calls that carried the right value. */
  argsCorrect: number;
  /** Share of grounding cases answered from the records. */
  grounding: number;
  madeUpSaves: number;
  /** Turns with three or more failed calls (the live `toolFailures` signal). */
  failedToolTurns: number;
  toolErrorsPerTurn: number;
  /** Errors per tool call: a turn that does more work makes more calls, and a refusal makes none. */
  toolErrorsPerCall: number;
  searchesPerTurn: number;
  unknownTools: number;
  avgLoaded: number;
  avgCents: number;
  /** Mean cost of the runs whose first call read the cache. Null when none did. */
  warmCents: number | null;
  medianFirstTokenMs: number;
  medianTotalMs: number;
  failedCases: string[];
};

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/**
 * The share of graded verdicts that passed; 1 when none applied.
 * @param verdicts - One per run, null where the dimension did not apply.
 */
function share(verdicts: Array<boolean | null>): number {
  const applied = verdicts.filter((v): v is boolean => v !== null);
  return applied.length ? applied.filter(Boolean).length / applied.length : 1;
}

/**
 * A case failed on any dimension it is graded on.
 * @param g - Its grade.
 */
function failed(g: CaseGrade): boolean {
  return g.aware === false || g.falseRefusal || g.argsOk === false || g.grounded === false || g.madeUpSave;
}

/**
 * One row per mode and level.
 * @param cases - The dataset.
 * @param runs - Every run.
 */
export function summarize(cases: readonly EvalCase[], runs: readonly CaseRun[]): ModeSummary[] {
  const byId = new Map(cases.map(c => [c.id, c]));
  const keys = [...new Set(runs.map(r => `${r.mode}|${r.level}`))];
  return keys.map((key) => {
    const [mode, level] = key.split('|') as [CaseRun['mode'], CaseRun['level']];
    const all = runs.filter(r => r.mode === mode && r.level === level);
    const graded = all.filter(r => !r.crashed);
    const grades = graded.map(r => ({ r, g: gradeCase(byId.get(r.caseId)!, r) }));
    const withTool = grades.filter(x => x.g.aware !== null);
    const warm = graded.filter(r => r.warm);
    return {
      mode,
      level,
      runs: all.length,
      crashed: all.length - graded.length,
      awareness: withTool.length ? withTool.filter(x => x.g.aware).length / withTool.length : 1,
      falseRefusals: grades.filter(x => x.g.falseRefusal).length,
      argsCorrect: share(grades.map(x => x.g.argsOk)),
      grounding: share(grades.map(x => x.g.grounded)),
      madeUpSaves: grades.filter(x => x.g.madeUpSave).length,
      failedToolTurns: graded.filter(r => r.toolErrors >= FAILED_TOOLS_THRESHOLD).length,
      toolErrorsPerTurn: mean(graded.map(r => r.toolErrors)),
      toolErrorsPerCall: (() => {
        const callCount = graded.reduce((n, r) => n + r.calls.length, 0);
        return callCount ? graded.reduce((n, r) => n + r.toolErrors, 0) / callCount : 0;
      })(),
      searchesPerTurn: mean(graded.map(r => r.searches)),
      unknownTools: graded.reduce((n, r) => n + r.unknownTools, 0),
      avgLoaded: mean(graded.map(r => r.loaded)),
      avgCents: mean(graded.map(r => r.cents)),
      warmCents: warm.length ? mean(warm.map(r => r.cents)) : null,
      medianFirstTokenMs: median(graded.map(r => r.firstTokenMs)),
      medianTotalMs: median(graded.map(r => r.totalMs)),
      failedCases: [...new Set(grades.filter(x => failed(x.g)).map(x => x.r.caseId))],
    };
  });
}

/** The gate `core` must pass before it is switched on (ADR 0009). */
export const GATE = { minAwareness: 0.95, maxFalseRefusals: 0, maxExtraWarmCentsStandard: 2, maxExtraFirstTokenMs: 1000 } as const;

export type GateCheck = { name: string; pass: boolean; detail: string };

/**
 * `core` against the `history` baseline, level by level.
 * @param rows - `summarize` output.
 */
export function checkGate(rows: readonly ModeSummary[]): GateCheck[] {
  const checks: GateCheck[] = [];
  for (const level of ['quick', 'standard'] as const) {
    const core = rows.find(r => r.mode === 'core' && r.level === level);
    const base = rows.find(r => r.mode === 'history' && r.level === level);
    if (!core || !base) {
      continue;
    }
    checks.push({ name: `${level}: tool awareness >= 95%`, pass: core.awareness >= GATE.minAwareness, detail: `${(core.awareness * 100).toFixed(0)}% (history ${(base.awareness * 100).toFixed(0)}%)` });
    checks.push({ name: `${level}: 0 false refusals`, pass: core.falseRefusals <= GATE.maxFalseRefusals, detail: `${core.falseRefusals} (history ${base.falseRefusals})` });
    // Per call, not per turn: a refusal makes no calls and so no errors, and
    // the per-turn number would reward it. Both are in the detail.
    checks.push({ name: `${level}: tool errors no worse (per call)`, pass: core.toolErrorsPerCall <= base.toolErrorsPerCall + 1e-9, detail: `${(core.toolErrorsPerCall * 100).toFixed(0)}% of calls, ${core.toolErrorsPerTurn.toFixed(2)}/turn (history ${(base.toolErrorsPerCall * 100).toFixed(0)}%, ${base.toolErrorsPerTurn.toFixed(2)}/turn)` });
    if (level === 'standard') {
      const extra = core.warmCents !== null && base.warmCents !== null ? core.warmCents - base.warmCents : null;
      checks.push({ name: 'standard: at most +2¢ per warm turn', pass: extra !== null && extra <= GATE.maxExtraWarmCentsStandard, detail: extra === null ? 'no warm runs' : `${extra >= 0 ? '+' : ''}${extra.toFixed(2)}¢ (${core.warmCents!.toFixed(2)}¢ vs ${base.warmCents!.toFixed(2)}¢)` });
    }
    const slower = core.medianFirstTokenMs - base.medianFirstTokenMs;
    checks.push({ name: `${level}: first response at most 1 s slower`, pass: slower <= GATE.maxExtraFirstTokenMs, detail: `${slower >= 0 ? '+' : ''}${slower} ms (median ${core.medianFirstTokenMs} vs ${base.medianFirstTokenMs} ms)` });
  }
  return checks;
}

/** One figure across repetitions: its mean, spread and range. */
export type Spread = { mean: number; sd: number; min: number; max: number; n: number };

/**
 * The spread of a figure over repetitions (sample standard deviation).
 * @param values - The figure, once per repetition.
 */
export function spreadOf(values: readonly number[]): Spread {
  const n = values.length;
  const m = mean([...values]);
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : 0;
  return { mean: m, sd, min: n ? Math.min(...values) : 0, max: n ? Math.max(...values) : 0, n };
}

/**
 * The 95% Wilson interval for a pass rate: honest at the edges, where a
 * normal interval around 100% would claim certainty a few dozen cases do
 * not give.
 * @param passed - Passes, pooled over repetitions.
 * @param total - Graded verdicts, pooled over repetitions.
 */
export function wilson95(passed: number, total: number): [number, number] {
  if (total === 0) {
    return [0, 1];
  }
  const z = 1.96;
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** A mode and level over every repetition: the pooled row, each figure's spread, and the cases that passed only sometimes. */
export type RepeatedSummary = {
  pooled: ModeSummary;
  reps: number;
  awarenessCi95: [number, number];
  spread: Record<'awareness' | 'falseRefusals' | 'argsCorrect' | 'grounding' | 'madeUpSaves' | 'toolErrorsPerCall' | 'warmCents' | 'medianFirstTokenMs', Spread>;
  /** Cases that passed in some repetitions and failed in others, with their pass count. */
  flaky: Array<{ caseId: string; passed: number; of: number }>;
  /** Cases that failed every repetition. */
  alwaysFailed: string[];
};

/**
 * Every mode and level, pooled over repetitions with the spread of each figure.
 * @param cases - The dataset.
 * @param runs - Every run, each carrying its `rep`.
 */
export function summarizeRepeated(cases: readonly EvalCase[], runs: readonly CaseRun[]): RepeatedSummary[] {
  const byId = new Map(cases.map(c => [c.id, c]));
  const pooled = summarize(cases, runs);
  return pooled.map((row) => {
    const mine = runs.filter(r => r.mode === row.mode && r.level === row.level);
    const reps = [...new Set(mine.map(r => r.rep ?? 0))].sort((a, b) => a - b);
    const perRep = reps.map(rep => summarize(cases, mine.filter(r => (r.rep ?? 0) === rep))[0]!);
    const pick = (f: (s: ModeSummary) => number | null) => spreadOf(perRep.map(f).filter((v): v is number => v !== null));
    const verdicts = mine.filter(r => !r.crashed).map(r => gradeCase(byId.get(r.caseId)!, r).aware).filter((v): v is boolean => v !== null);
    const perCase = new Map<string, { passed: number; of: number }>();
    for (const r of mine.filter(x => !x.crashed)) {
      const tally = perCase.get(r.caseId) ?? { passed: 0, of: 0 };
      tally.of += 1;
      tally.passed += failed(gradeCase(byId.get(r.caseId)!, r)) ? 0 : 1;
      perCase.set(r.caseId, tally);
    }
    const tallies = [...perCase.entries()].map(([caseId, t]) => ({ caseId, ...t }));
    return {
      pooled: row,
      reps: reps.length,
      awarenessCi95: wilson95(verdicts.filter(Boolean).length, verdicts.length),
      spread: {
        awareness: pick(s => s.awareness),
        falseRefusals: pick(s => s.falseRefusals),
        argsCorrect: pick(s => s.argsCorrect),
        grounding: pick(s => s.grounding),
        madeUpSaves: pick(s => s.madeUpSaves),
        toolErrorsPerCall: pick(s => s.toolErrorsPerCall),
        warmCents: pick(s => s.warmCents),
        medianFirstTokenMs: pick(s => s.medianFirstTokenMs),
      },
      flaky: tallies.filter(t => t.passed > 0 && t.passed < t.of),
      alwaysFailed: tallies.filter(t => t.passed === 0).map(t => t.caseId),
    };
  });
}
