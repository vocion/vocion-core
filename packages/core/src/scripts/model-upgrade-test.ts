/**
 * Model-upgrade test, from the command line.
 *
 *   npm run eval:upgrade -- --dataset <slug> --baseline gpt-5.6-sol --candidate gpt-6-astra [--org <id>] [--no-briefing]
 *
 * Runs the dataset on both models (sequentially, same judge), prints the
 * comparison the briefing carries, and exits 0 when the candidate is no worse
 * on pass rate — the CI-shaped reading of "the workforce got better, or at
 * least not worse, with the new model."
 *
 * `--baseline-provider` / `--candidate-provider` (anthropic | openai | bedrock)
 * are only needed for an id whose shape does not name its vendor.
 */

import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error('usage: npm run eval:upgrade -- --dataset <slug> --baseline <model> --candidate <model> [--org <id>] [--baseline-provider p] [--candidate-provider p] [--no-briefing]');
  process.exit(2);
}

async function main() {
  const datasetSlug = flag('dataset');
  const baselineModel = flag('baseline');
  const candidateModel = flag('candidate');
  if (!datasetSlug || !baselineModel || !candidateModel) {
    usage();
  }
  const orgId = flag('org') ?? process.env.VOCION_DEFAULT_ORG ?? process.env.VOCION_ORG_ID;
  if (!orgId) {
    console.error('no org: pass --org <id> or set VOCION_DEFAULT_ORG');
    process.exit(2);
  }
  const asProvider = (v: string | undefined) => (v === 'anthropic' || v === 'openai' || v === 'bedrock' ? v : undefined);

  const { renderComparisonMarkdown, runModelUpgradeTest } = await import('../services/evals/modelUpgradeTest');

  console.log(`🧪 model upgrade test — ${datasetSlug} — ${baselineModel} → ${candidateModel}\n`);
  const result = await runModelUpgradeTest({
    orgId,
    datasetSlug,
    baselineModel,
    candidateModel,
    baselineProvider: asProvider(flag('baseline-provider')),
    candidateProvider: asProvider(flag('candidate-provider')),
    publish: !has('no-briefing'),
    onProgress: line => console.log(`→ ${line}`),
  });

  console.log(`\n${renderComparisonMarkdown(result.comparison)}\n`);
  console.log(`runs: baseline #${result.baselineRunId}, candidate #${result.candidateRunId}${result.briefingId ? `; briefing #${result.briefingId}` : ''}`);
  console.log(`open: /dashboard/evals/${datasetSlug}/compare?baseline=${result.baselineRunId}&candidate=${result.candidateRunId}`);

  const { baseline, candidate } = result.comparison;
  process.exit(candidate.passRate >= baseline.passRate ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
