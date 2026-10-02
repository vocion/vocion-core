#!/usr/bin/env tsx
/**
 * Re-link one release to what it shipped, through the path a deploy takes
 * (`relinkRelease` in `services/factory/releasePack.ts`): each criterion with
 * the artifact that proves it, the named-test runs beside the screenshots,
 * and a drafted announcement without its internal sentences. Dry run by
 * default: it prints the pack and writes nothing. Idempotent with `--apply`.
 *
 * Usage:
 *   npm run release:relink -- --project <orgId> --release <id>            # dry run
 *   npm run release:relink -- --project <orgId> --release <id> --apply    # write it
 */
import process from 'node:process';
import { relinkRelease } from '@/services/factory/releasePack';

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const orgId = arg('--project');
  const releaseId = Number(arg('--release'));
  if (!orgId || !Number.isSafeInteger(releaseId) || releaseId <= 0) {
    console.error('Usage: release:relink -- --project <orgId> --release <id> [--apply]');
    process.exit(2);
  }
  const report = await relinkRelease(orgId, releaseId, { apply: argv.includes('--apply') });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.linked ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
