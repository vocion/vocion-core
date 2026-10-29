/**
 * Grading the `agent-behaviour` eval (ADR 0009). Pure: a run is graded from
 * what it did, with no model call. The gate is the one the switch to `core`
 * loading must pass.
 */
import type { EvalCase } from './dataset';

/** What one case did in one mode and level. */
export type CaseRun = {
  caseId: string;
  agent: string;
  kind: EvalCase['kind'];
  mode: 'history' | 'core' | 'all';
  level: 'quick' | 'standard';
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

/**
 * "I can't", "I don't have a tool", "you'll need to do it yourself": an
 * answer that declines for want of the ability. A question back or a
 * confirmation request is not a refusal.
 */
const REFUSAL = /\b(?:I\s+(?:can(?:'|’)?t|cannot|am\s+(?:not\s+able|unable)|(?:do\s+not|don(?:'|’)t)\s+have\s+(?:a\s+|the\s+|any\s+)?(?:tool|ability|access|way|capabilit))|(?:not|isn(?:'|’)t)\s+(?:something|an\s+action)\s+I\s+(?:can|take)|you(?:'|’)ll\s+(?:need|have)\s+to\s+(?:do|make|update|change)\s+(?:it|that|this|the)|outside\s+(?:of\s+)?(?:my|what\s+I)|no\s+(?:tool|way)\s+(?:to|for))/i;

export function isRefusal(answer: string): boolean {
  return REFUSAL.test(answer);
}

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
};

/**
 * Grade one run. Every case is something the agent can do, so any refusal
 * that comes without the work is a false one.
 * @param c - The case.
 * @param run - What it did.
 */
export function gradeCase(c: EvalCase, run: CaseRun): CaseGrade {
  const aware = c.expectTools.length ? usedExpectedTool(c, run) : null;
  return { aware, falseRefusal: aware !== true && isRefusal(run.answer) };
}

export type ModeSummary = {
  mode: CaseRun['mode'];
  level: CaseRun['level'];
  runs: number;
  crashed: number;
  awareness: number;
  falseRefusals: number;
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
      failedCases: grades.filter(x => x.g.aware === false || x.g.falseRefusal).map(x => x.r.caseId),
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
