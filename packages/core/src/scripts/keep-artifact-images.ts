#!/usr/bin/env tsx
/**
 * Copy the bytes of existing image artifacts into Vocion's artifact store —
 * see `services/artifacts/imageIngest.ts`. Rows written before copies were
 * kept still point at an external link (a QA screenshot's S3 presigned GET,
 * which stops working seven days after it was signed).
 *
 * Dry run by default: it reads the rows, reports what it would copy and which
 * links have already expired, and fetches nothing. `--apply` copies. A copied
 * row's `url` is in the store, so a re-run selects nothing it already did.
 *
 * Usage:
 *   npm run artifacts:keep-images                              # every workspace, dry run
 *   npm run artifacts:keep-images -- --project <orgId>         # one workspace, dry run
 *   npm run artifacts:keep-images -- --ids 1361,1363           # just these rows, dry run
 *   npm run artifacts:keep-images -- --apply                   # copy them
 */
import process from 'node:process';
import { keepExistingImages } from '@/services/artifacts/imageIngest';

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const orgId = flag('--project');
  const ids = (flag('--ids') ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  const apply = argv.includes('--apply');
  const counts = await keepExistingImages({ apply, orgId, ids, log: line => console.warn(line) });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scope: orgId ?? 'all workspaces', ...(ids.length ? { ids } : {}), ...counts }, null, 2));
  process.exit(counts.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
