#!/usr/bin/env tsx
/**
 * Fold every person's per-Org Personals into their one Personal
 * (`services/personal/merge.ts`).
 *
 * A dry run by default: it prints, per person, the Personal that stays, each
 * one folded into it, and how many rows of each kind would move, and writes
 * nothing. `--apply` does it, one transaction per person. Idempotent: a folded
 * Personal is archived and never folded again, so a second run reports
 * nothing to do. `--user <id>` limits it to one person.
 *
 * Usage:
 *   npm run personal-projects:merge                 # dry run, everyone
 *   npm run personal-projects:merge -- --apply      # do it
 *   npm run personal-projects:merge -- --user usr-… # one person
 */
import process from 'node:process';
import { mergePersonalProjects } from '@/services/personal/merge';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const at = args.indexOf('--user');
  const userId = at >= 0 ? args[at + 1] : undefined;
  const reports = await mergePersonalProjects({ apply, userId });
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing written; pass --apply to do it)');
  if (reports.length === 0) {
    console.log('Nobody has more than one Personal: nothing to do.');
  }
  for (const r of reports) {
    console.log(`\n${r.userId}: keep ${r.keep.id} (Org ${r.keep.accountId})`);
    for (const f of r.folds) {
      const moved = Object.entries(f.counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ') || 'nothing';
      console.log(`  fold ${f.id} (Org ${f.accountId}) -> archived; moves: ${moved}`);
    }
    const skipped = Object.entries(r.skipped).map(([t, n]) => `${t} ${n}`).join(', ');
    if (skipped) {
      console.log(`  left with the archive (already held by the kept Personal): ${skipped}`);
    }
    if (r.rhythmsDropped > 0) {
      console.log(`  daily rhythm: ${r.rhythmsDropped} duplicate dropped, one kept on the home Org`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Merge failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
