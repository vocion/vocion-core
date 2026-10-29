import type { CaseRun } from '@/services/evals/agentBehaviour/score';
/**
 * The `agent-behaviour` eval (ADR 0009), against the real model and made-up
 * data: every case in every tool-loading mode at Quick and Standard, then
 * the gate `core` must pass to be switched on.
 *
 *   dotenv -c -- tsx --tsconfig ./tsconfig.json src/scripts/eval-agent-behaviour.ts \
 *     [--modes history,core,all] [--levels quick,standard] [--cases pa-write-deal,...] \
 *     [--repeat 3] [--out results.json] [--markdown results.md]
 *
 * Needs ANTHROPIC_API_KEY (direct Anthropic: tool search runs there). Needs
 * no database, workspace or connector. One repetition of every case in every
 * mode and level costs about $20; `--repeat 3` about $60. A deployment's
 * nightly CI (`docs/guides/agent-evals.md`, ADR 0010) runs a smaller slice;
 * the `eval:agent-behaviour` npm script is the same command.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { mapWithConcurrency } from '@/libs/concurrency';
import { EVAL_AGENTS, EVAL_CASES, EVAL_LEVELS, EVAL_MODES } from '@/services/evals/agentBehaviour/dataset';
import { resultsMarkdown } from '@/services/evals/agentBehaviour/report';
import { runCase } from '@/services/evals/agentBehaviour/run';
import { checkGate, summarizeRepeated } from '@/services/evals/agentBehaviour/score';

const { values } = parseArgs({
  options: {
    modes: { type: 'string', default: EVAL_MODES.join(',') },
    levels: { type: 'string', default: EVAL_LEVELS.join(',') },
    cases: { type: 'string' },
    out: { type: 'string', default: 'agent-behaviour-results.json' },
    concurrency: { type: 'string', default: '3' },
    repeat: { type: 'string', default: '1' },
    markdown: { type: 'string' },
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
  // Repetitions are separate groups, so they run side by side too.
  const repeat = Math.max(1, Number(values.repeat) || 1);
  const reps = Array.from({ length: repeat }, (_, rep) => rep);
  const groups = reps.flatMap(rep => EVAL_AGENTS.flatMap(agent => modes.flatMap(mode => levels.map(level => ({ rep, agent, mode, level, cases: cases.filter(c => c.agent === agent.slug) }))))).filter(g => g.cases.length > 0);
  const runs: CaseRun[] = (await mapWithConcurrency(groups, Number(values.concurrency), async (g) => {
    const out: CaseRun[] = [];
    for (const evalCase of g.cases) {
      const run = { ...await runCase({ agent: g.agent, evalCase, mode: g.mode, level: g.level }), rep: g.rep };
      console.log(`r${g.rep} ${g.mode.padEnd(7)} ${g.level.padEnd(8)} ${evalCase.id.padEnd(22)} tools=${run.calls.map(c => c.tool + (c.error ? '!' : '')).join(',') || '-'} searches=${run.searches} ${run.cents.toFixed(2)}¢ ${run.crashed ? `CRASHED ${run.crashed}` : ''}`);
      out.push(run);
    }
    return out;
  })).flat();
  const repeated = summarizeRepeated(cases, runs);
  const rows = repeated.map(r => r.pooled);
  const gate = checkGate(rows);
  const markdown = resultsMarkdown(repeated, gate);
  console.log(markdown);
  writeFileSync(values.out!, JSON.stringify({ at: new Date().toISOString(), repeat, cases: cases.length, rows, repeated, gate, runs }, null, 2));
  if (values.markdown) {
    writeFileSync(values.markdown, markdown);
  }
  console.log(`wrote ${values.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
