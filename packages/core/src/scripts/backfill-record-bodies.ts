#!/usr/bin/env tsx
/**
 * Give every existing record its body artifact (backlog 035) — see
 * `services/objects/recordBodyBackfill.ts`. Dry run by default: it counts
 * what it would create and writes nothing. Idempotent: a re-run with
 * `--apply` creates nothing that exists.
 *
 * Usage:
 *   npm run objects:backfill-bodies                          # every workspace, dry run
 *   npm run objects:backfill-bodies -- --project <orgId>     # one workspace, dry run
 *   npm run objects:backfill-bodies -- --apply               # create them
 */
import process from 'node:process';
import { backfillRecordBodies } from '@/services/objects/recordBodyBackfill';

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--project');
  const orgId = at === -1 ? undefined : argv[at + 1];
  const apply = argv.includes('--apply');
  const counts = await backfillRecordBodies({ orgId, apply, log: line => console.warn(line) });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scope: orgId ?? 'all workspaces', ...counts }, null, 2));
  process.exit(counts.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
