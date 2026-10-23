#!/usr/bin/env tsx
/**
 * Put an eval run (packages/runner/eval) on the engine scoreboard, in the same
 * shape as the factory's own runs, `source: eval` (ADR 0005). A re-import
 * replaces the run's rows.
 *
 * Usage:
 *   npx tsx src/scripts/import-eval-runs.ts --org <org id> --engine openhands \
 *     --file ../runner/eval/results/2026-10-22-openhands/runs.jsonl [--label 2026-10-22-openhands]
 *
 * The label defaults to the results folder's name.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { importEvalRuns } from '@/services/factory/engineRun';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
  const org = arg('org');
  const engine = arg('engine');
  const file = arg('file');
  if (!org || !engine || !file) {
    console.error('Usage: import-eval-runs --org <org id> --engine <engine> --file <runs.jsonl> [--label <name>]');
    process.exit(2);
  }
  const label = arg('label') ?? path.basename(path.dirname(path.resolve(file)));
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const n = await importEvalRuns(org, label, engine, lines);
  console.log(`imported ${n} eval run(s) from ${label} as ${engine}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
