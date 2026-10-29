import type { CaseRun } from '@/services/evals/agentBehaviour/score';
/**
 * The `agent-behaviour` eval (ADR 0009), against the real model and made-up
 * data: every case in every tool-loading mode at Quick and Standard, then
 * the gate `core` must pass to be switched on.
 *
 *   dotenv -c -- tsx --tsconfig ./tsconfig.json src/scripts/eval-agent-behaviour.ts \
 *     [--modes history,core,all] [--levels quick,standard] [--cases pa-write-deal,...] [--out results.json]
 *
 * Needs ANTHROPIC_API_KEY (direct Anthropic: tool search runs there). Needs
 * no database, workspace or connector. Costs a few dollars for a full run.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { mapWithConcurrency } from '@/libs/concurrency';
import { EVAL_AGENTS, EVAL_CASES, EVAL_LEVELS, EVAL_MODES } from '@/services/evals/agentBehaviour/dataset';
import { runCase } from '@/services/evals/agentBehaviour/run';
import { checkGate, summarize } from '@/services/evals/agentBehaviour/score';

const { values } = parseArgs({
  options: {
    modes: { type: 'string', default: EVAL_MODES.join(',') },
    levels: { type: 'string', default: EVAL_LEVELS.join(',') },
    cases: { type: 'string' },
    out: { type: 'string', default: 'agent-behaviour-results.json' },
    concurrency: { type: 'string', default: '3' },
  },
});

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  const modes = values.modes!.split(',') as Array<typeof EVAL_MODES[number]>;
  const levels = values.levels!.split(',') as Array<typeof EVAL_LEVELS[number]>;
  const only = values.cases ? new Set(values.cases.split(',')) : null;
  const cases = EVAL_CASES.filter(c => !only || only.has(c.id));
  // One group per agent, mode and level, run in order, so every case after
  // the first reads the agent's prefix from the cache, as a live
  // conversation does. Groups run side by side.
  const groups = EVAL_AGENTS.flatMap(agent => modes.flatMap(mode => levels.map(level => ({ agent, mode, level, cases: cases.filter(c => c.agent === agent.slug) })))).filter(g => g.cases.length > 0);
  const runs: CaseRun[] = (await mapWithConcurrency(groups, Number(values.concurrency), async (g) => {
    const out: CaseRun[] = [];
    for (const evalCase of g.cases) {
      const run = await runCase({ agent: g.agent, evalCase, mode: g.mode, level: g.level });
      console.log(`${g.mode.padEnd(7)} ${g.level.padEnd(8)} ${evalCase.id.padEnd(22)} tools=${run.calls.map(c => c.tool + (c.error ? '!' : '')).join(',') || '-'} searches=${run.searches} ${run.cents.toFixed(2)}¢ ${run.crashed ? `CRASHED ${run.crashed}` : ''}`);
      out.push(run);
    }
    return out;
  })).flat();
  const rows = summarize(cases, runs);
  console.table(rows.map(r => ({ mode: r.mode, level: r.level, runs: r.runs, crashed: r.crashed, awareness: `${(r.awareness * 100).toFixed(0)}%`, falseRefusals: r.falseRefusals, toolErrorsPerTurn: r.toolErrorsPerTurn.toFixed(2), errorsPerCall: `${(r.toolErrorsPerCall * 100).toFixed(0)}%`, searchesPerTurn: r.searchesPerTurn.toFixed(2), loaded: r.avgLoaded.toFixed(0), avgCents: r.avgCents.toFixed(2), warmCents: r.warmCents?.toFixed(2) ?? '-', firstTokenMs: r.medianFirstTokenMs, totalMs: r.medianTotalMs, failed: r.failedCases.join(' ') })));
  const gate = checkGate(rows);
  console.table(gate);
  writeFileSync(values.out!, JSON.stringify({ at: new Date().toISOString(), rows, gate, runs }, null, 2));
  console.log(`wrote ${values.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
