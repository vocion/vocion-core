#!/usr/bin/env tsx
/**
 * Mark every repeating calendar entry the candidate extractor already finished
 * on as due for one more read, see `services/ProcessorRevisitBackfill.ts`.
 * Dry run by default: it counts what it would mark, per source, and writes
 * nothing. Idempotent: a re-run with `--apply` marks nothing already marked.
 *
 * Usage:
 *   npm run sources:backfill-revisits                          # every workspace, dry run
 *   npm run sources:backfill-revisits -- --project <orgId>     # one workspace, dry run
 *   npm run sources:backfill-revisits -- --apply               # mark them
 */
import process from 'node:process';
import { backfillProcessorRevisits } from '@/services/ProcessorRevisitBackfill';

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--project');
  const orgId = at === -1 ? undefined : argv[at + 1];
  const apply = argv.includes('--apply');
  const counts = await backfillProcessorRevisits({ orgId, apply });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scope: orgId ?? 'all workspaces', ...counts }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
