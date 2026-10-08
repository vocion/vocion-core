import process from 'node:process';
import { parseArgs } from 'node:util';
import { offboardAccount, OffboardError } from '@/services/AccountOffboardService';
import 'dotenv/config';

/**
 * Offboard one client account: export everything it owns, then delete it.
 *
 *   npm run account:offboard -- --account <id|slug> --out <dir> --dry-run
 *   npm run account:offboard -- --account <id|slug> --out <dir> --confirm <slug>
 *
 * `--dry-run` counts what would go — every table, every person, anything that
 * would stop it — and writes only `<dir>/manifest.json`. Without it, the run
 * exports to `<dir>` (`tables/*.jsonl`, `members.json`, `artifacts/…`), then
 * deletes every row in one transaction, and needs `--confirm` naming the
 * account's slug, so a mistyped id cannot delete the wrong client.
 *
 * Stop the account's activity first (remove its people's access): a row
 * written between the export and the delete makes the run refuse and delete
 * nothing, rather than delete something that was never exported.
 *
 * The rules — what counts as the account's, who is kept, what is redacted —
 * are in `services/AccountOffboardService.ts`.
 */

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'account': { type: 'string' },
      'out': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'confirm': { type: 'string' },
    },
  });
  const account = values.account?.trim();
  const out = values.out?.trim();
  if (!account || !out) {
    console.error('usage: account-offboard --account <id|slug> --out <dir> [--dry-run | --confirm <slug>]');
    return 2;
  }
  const dryRun = values['dry-run'] === true;

  if (!dryRun) {
    // Plan first to learn the slug the confirmation has to name.
    const preview = await offboardAccount({ account, outDir: out, dryRun: true });
    if (values.confirm !== preview.plan.account.slug) {
      console.error(`refusing: pass --confirm ${preview.plan.account.slug} to delete "${preview.plan.account.name}" (${preview.plan.account.id}). The plan is in ${out}/manifest.json.`);
      return 2;
    }
  }

  const manifest = await offboardAccount({ account, outDir: out, dryRun });
  const { plan } = manifest;
  const total = plan.tables.reduce((sum, entry) => sum + entry.rows, 0);
  console.log(`${manifest.mode}: ${plan.account.name} (${plan.account.slug}, ${plan.account.id})`);
  console.log(`  workspaces : ${plan.workspaces.map(w => w.slug).join(', ') || 'none'}`);
  console.log(`  rows       : ${total} across ${plan.tables.length} tables`);
  for (const entry of plan.tables) {
    console.log(`    ${entry.table.padEnd(32)} ${String(entry.rows).padStart(8)}  ${entry.scope} via ${entry.via}`);
  }
  console.log(`  people     : ${plan.users.deleted.length} deleted, ${plan.users.kept.length} kept`);
  for (const kept of plan.users.kept) {
    console.log(`    kept ${kept.email}: ${kept.reason}`);
  }
  if (plan.crossReferences.length > 0) {
    console.log('  BLOCKED by rows outside the account that point into it:');
    for (const ref of plan.crossReferences) {
      console.log(`    ${ref.rows} in ${ref.table}.${ref.columns.join(',')} -> ${ref.references}`);
    }
  }
  if (manifest.export) {
    console.log(`  exported   : ${manifest.export.files.length} files, ${manifest.export.artifacts.written} artifacts as pages`);
  }
  console.log(`  manifest   : ${out}/manifest.json`);
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch((error) => {
    console.error(error instanceof OffboardError ? error.message : error);
    process.exit(1);
  });
