/**
 * `npm run people:apply -- <deployment-dir> [--account <id>] [--dry-run]`
 *
 * Seeds people and groups into the database. Create-if-absent: it never
 * updates or deletes what a person changed in the interface, with the one
 * exception `PeopleSeedService` documents.
 *
 * Exit codes mirror `workspace:apply` so a deploy can tell the two failures
 * apart: 2 when the files do not validate, 1 when the apply hit an error, 0
 * otherwise. Warnings do not fail the run — a person who has not signed up yet
 * is an ordinary state, not a broken deploy.
 */

import process from 'node:process';
import { loadSeed, SeedValidationError } from '@/libs/deployment/loader';
import { applySeed, defaultAccountId } from '@/services/PeopleSeedService';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) {
    console.error('usage: people:apply -- <deployment-dir> [--account <id>] [--dry-run]');
    process.exit(2);
  }
  const dryRun = process.argv.includes('--dry-run');

  let seed;
  try {
    seed = loadSeed(dir);
  } catch (err) {
    if (err instanceof SeedValidationError) {
      console.error(`[people:apply] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  console.warn(`[people:apply] ${seed.groups.length} group(s), ${seed.people.length} person/people from ${dir}`);

  const accountId = arg('account') ?? await defaultAccountId();
  if (!accountId) {
    console.error('[people:apply] no tenant account has any members yet — sign in once, then re-run.');
    process.exit(1);
  }

  const r = await applySeed(seed, { accountId, dryRun });
  const tag = dryRun ? 'would ' : '';

  console.warn(`[people:apply] account ${r.accountId}`);
  console.warn(`[people:apply] groups: ${tag}create ${r.groups.created.length}, left alone ${r.groups.existing.length}`);
  console.warn(`[people:apply] grants: ${tag}create ${r.grants.created.length}`);
  console.warn(`[people:apply] people: ${tag}invite ${r.people.invited.length}, already here ${r.people.existing.length}`);
  console.warn(`[people:apply] group memberships: ${tag}create ${r.memberships.created.length}`);

  if (r.revoked.length > 0) {
    // Named individually. This is the only destructive thing the applier does,
    // so it should never be a number someone has to go and look up.
    console.warn(`[people:apply] ${tag}revoke ${r.revoked.length} backfilled grant(s):`);
    for (const x of r.revoked) {
      console.warn(`[people:apply]   ${x.email} loses ${x.workspace}`);
    }
  }
  for (const w of r.warnings) {
    console.warn(`[people:apply] warning: ${w}`);
  }
  if (dryRun) {
    console.warn('[people:apply] dry run — nothing was written.');
  }
}

main().catch((err) => {
  console.error('[people:apply] failed:', err);
  process.exit(1);
});
