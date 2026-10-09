#!/usr/bin/env tsx
/**
 * repair-ghost-projects — fold the "Project proj-…" ghost workspaces that
 * migration 0022 minted back into the workspaces they shadow, then archive
 * them. Never deletes a workspace. See `services/maintenance/ghostProjects.ts`.
 *
 * Dry run by default: every Org's repair runs inside a transaction, the
 * per-table counts are printed, and it rolls back.
 *
 *   npx dotenv -c -- npx tsx src/scripts/repair-ghost-projects.ts            # dry run, every Org
 *   npx dotenv -c -- npx tsx src/scripts/repair-ghost-projects.ts --org <id> # dry run, one Org
 *   npx dotenv -c -- npx tsx src/scripts/repair-ghost-projects.ts --apply --org <id>
 *
 * Reads DATABASE_URL and prints nothing of it. A production container has no
 * TypeScript toolchain; bundle this file to one CommonJS file with
 * `npx esbuild src/scripts/repair-ghost-projects.ts --bundle --platform=node
 * --format=cjs --external:pg --outfile=repair-ghost-projects.cjs` and run it
 * with `node` there (the runbook in the PR does exactly that).
 *
 * Exit code: 0 on success, 1 if any Org failed (that Org was rolled back).
 */
import process from 'node:process';
import { Client } from 'pg';
import { formatRepairReport, repairGhostProjects } from '../services/maintenance/ghostProjects';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    return 1;
  }
  const apply = process.argv.includes('--apply');
  const accountId = arg('--org');
  // Connected exactly as the app connects (utils/DBConnection.ts).
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await repairGhostProjects(client, { apply, accountId });
    console.log(formatRepairReport(result));
    return result.orgs.some(o => o.error) ? 1 : 0;
  } finally {
    await client.end();
  }
}

main()
  .then(code => process.exit(code))
  .catch((error) => {
    console.error('[repair-ghost-projects] failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
