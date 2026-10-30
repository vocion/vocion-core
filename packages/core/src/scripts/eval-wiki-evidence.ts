/**
 * The `wiki-evidence` eval (ADR 0012): every question, in every condition
 * (search only, wiki, wiki + evidence graph), at Quick and Standard, `repeat`
 * times, against the real model, on made-up data. Needs ANTHROPIC_API_KEY;
 * no database, workspace or connector.
 *
 *   npm run eval:wiki-evidence -w @vocion/core -- \
 *     [--conditions search,wiki,graph] [--levels quick,standard] [--questions c-per-diem,...] \
 *     [--repeat 3] [--concurrency 6] [--out wiki-evidence.json] [--markdown wiki-evidence.md]
 *
 * `--from a.json,b.json` regrades saved runs instead of calling the model
 * (no key, no cost); a later file's runs replace an earlier file's for the
 * same condition and level, so a re-run of one condition merges in.
 */
import type { QuestionRun } from '@/services/evals/wikiEvidence/run';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { mapWithConcurrency } from '@/libs/concurrency';
import { corpusGraph } from '@/services/evals/wikiEvidence/corpus';
import { EVIDENCE_QUESTIONS } from '@/services/evals/wikiEvidence/dataset';
import { EVIDENCE_CONDITIONS, EVIDENCE_LEVELS, runQuestion } from '@/services/evals/wikiEvidence/run';
import { resultsTable, shipBar, summarize } from '@/services/evals/wikiEvidence/score';

async function main() {
  const { values } = parseArgs({
    options: {
      conditions: { type: 'string' },
      levels: { type: 'string' },
      questions: { type: 'string' },
      repeat: { type: 'string', default: '3' },
      concurrency: { type: 'string', default: '6' },
      out: { type: 'string', default: 'wiki-evidence.json' },
      markdown: { type: 'string' },
      from: { type: 'string' },
    },
  });
  const conditions = (values.conditions?.split(',') ?? [...EVIDENCE_CONDITIONS]) as Array<typeof EVIDENCE_CONDITIONS[number]>;
  const levels = (values.levels?.split(',') ?? [...EVIDENCE_LEVELS]) as Array<typeof EVIDENCE_LEVELS[number]>;
  const only = values.questions ? new Set(values.questions.split(',')) : null;
  const questions = EVIDENCE_QUESTIONS.filter(q => !only || only.has(q.id));
  const repeat = Math.max(1, Number(values.repeat));
  const graph = corpusGraph();
  const jobs = Array.from({ length: repeat }, (_, rep) => rep).flatMap(rep => levels.flatMap(level => conditions.flatMap(condition => questions.map(question => ({ rep, level, condition, question })))));
  const runs = values.from
    ? savedRuns(values.from.split(','))
    : await mapWithConcurrency(jobs, Math.max(1, Number(values.concurrency)), async (j) => {
        const run = await runQuestion({ ...j, graph });
        console.log(`r${j.rep} ${j.level.padEnd(8)} ${j.condition.padEnd(6)} ${j.question.id.padEnd(22)} ${run.crashed ? `CRASHED ${run.crashed}` : `${run.calls.map(c => c.tool + (c.error ? '!' : '')).join(',') || '-'} ${run.cents.toFixed(2)}¢`}`);
        return run;
      });
  const cells = summarize(questions, runs);
  const bar = shipBar(cells);
  const markdown = [resultsTable(cells), '', '| Ship bar (ADR 0012) | Level | Pass | Detail |', '|---|---|---|---|', ...bar.map(b => `| ${b.check} | ${b.level} | ${b.pass ? 'yes' : '**no**'} | ${b.detail} |`)].join('\n');
  console.log(`\n${markdown}\n\ntotal spent: ${(runs.reduce((s, r) => s + r.cents, 0) / 100).toFixed(2)} USD over ${runs.length} runs`);
  writeFileSync(values.out!, JSON.stringify({ at: new Date().toISOString(), repeat, cells, bar, runs }, null, 2));
  if (values.markdown) {
    writeFileSync(values.markdown, markdown);
  }
}

/**
 * Runs saved by earlier invocations, a later file replacing an earlier one's condition and level.
 * @param files - The `--out` files, oldest first.
 */
function savedRuns(files: readonly string[]): QuestionRun[] {
  let runs: QuestionRun[] = [];
  for (const f of files) {
    const next = (JSON.parse(readFileSync(f, 'utf8')) as { runs: QuestionRun[] }).runs;
    const cells = new Set(next.map(r => `${r.condition}/${r.level}`));
    runs = [...runs.filter(r => !cells.has(`${r.condition}/${r.level}`)), ...next];
  }
  return runs;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
