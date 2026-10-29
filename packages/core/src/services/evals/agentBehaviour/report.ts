/**
 * The `agent-behaviour` eval's results as a person reads them: one line per
 * mode and level with each figure's spread over repetitions, then the gate.
 * Markdown, so the nightly job (ADR 0010) can put it in its run summary.
 */
import type { GateCheck, RepeatedSummary, Spread } from './score';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * A figure with its spread: `91% ±4 (86–95)`, or the bare figure for one repetition.
 * @param s - The spread.
 * @param format - How to print one value.
 */
export function withSpread(s: Spread, format: (v: number) => string): string {
  if (s.n <= 1) {
    return format(s.mean);
  }
  const sd = format(s.sd).replace(/[%¢]| ms/g, '');
  return `${format(s.mean)} ±${sd} (${format(s.min)}–${format(s.max)})`;
}

/**
 * The results table and the gate, in markdown.
 * @param rows - `summarizeRepeated` output.
 * @param gate - `checkGate` on the pooled rows.
 */
export function resultsMarkdown(rows: readonly RepeatedSummary[], gate: readonly GateCheck[]): string {
  const cents = (v: number) => `${v.toFixed(2)}¢`;
  const ms = (v: number) => `${Math.round(v)} ms`;
  const lines = [
    '| Mode | Level | Reps | Runs (crashed) | Awareness (95% CI) | False refusals / rep | Args correct | Grounded | Made-up saves / rep | Errors per call | ≥3 failed calls | Warm ¢/turn | First token (median) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.pooled.mode} | ${r.pooled.level} | ${r.reps} | ${r.pooled.runs} (${r.pooled.crashed}) | ${withSpread(r.spread.awareness, pct)} [${pct(r.awarenessCi95[0])}–${pct(r.awarenessCi95[1])}] | ${withSpread(r.spread.falseRefusals, v => v.toFixed(1))} | ${withSpread(r.spread.argsCorrect, pct)} | ${withSpread(r.spread.grounding, pct)} | ${withSpread(r.spread.madeUpSaves, v => v.toFixed(1))} | ${withSpread(r.spread.toolErrorsPerCall, pct)} | ${r.pooled.failedToolTurns} | ${r.spread.warmCents.n ? withSpread(r.spread.warmCents, cents) : '—'} | ${withSpread(r.spread.medianFirstTokenMs, ms)} |`),
    '',
    '| Gate (core against history, pooled) | Pass | Detail |',
    '|---|---|---|',
    ...gate.map(g => `| ${g.name} | ${g.pass ? 'yes' : '**no**'} | ${g.detail} |`),
    '',
    ...rows.filter(r => r.alwaysFailed.length || r.flaky.length).map(r => `- **${r.pooled.mode} ${r.pooled.level}**: failed every rep: ${r.alwaysFailed.join(', ') || 'none'}; flaky: ${r.flaky.map(f => `${f.caseId} ${f.passed}/${f.of}`).join(', ') || 'none'}`),
  ];
  return `${lines.join('\n')}\n`;
}
