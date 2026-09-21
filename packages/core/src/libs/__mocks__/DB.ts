/**
 * The database every unit test gets: an in-memory PGlite with this package's
 * full schema already on it.
 *
 * Restored from a dump rather than migrated. Building the schema meant
 * replaying 143 migrations, and 219 test files mock this module, so the same
 * two CPU-minutes of migration were spent on every run. `globalSetup` now does
 * that work once and leaves the finished database in a file — see
 * `libs/testing/migratedDatabaseSnapshot.ts` for the measurements and why the
 * file lives where it does.
 *
 * Each file still gets its OWN database, restored from the same dump. Sharing
 * one across files would let a test see rows another test wrote, which is the
 * kind of failure that only shows up when the order changes.
 */

import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_FOLDER, SNAPSHOT_PATH } from '@/libs/testing/migratedDatabaseSnapshot';
import * as schema from '@/models/Schema';

/**
 * A PGlite holding the migrated schema.
 *
 * Falls back to migrating when the dump is not there, so this module still
 * works for anything that loads it outside a vitest run with the global setup
 * — and so a missing dump costs time rather than breaking every database test
 * at once.
 */
async function migratedDatabase(): Promise<PGlite> {
  // pgvector has to be registered on the restored database too: the dump
  // carries the extension's data, not the code that reads it.
  try {
    const dump = await readFile(SNAPSHOT_PATH);
    return new PGlite({ loadDataDir: new Blob([dump]), extensions: { vector } });
  } catch (error) {
    // Said out loud, because the difference is about 450ms on every file that
    // takes this path — a suite that quietly got five times slower is worse to
    // diagnose than one that says why.
    console.warn(
      `[test db] no migrated snapshot at ${SNAPSHOT_PATH}, migrating instead`,
      error instanceof Error ? error.message : String(error),
    );
    const fresh = new PGlite({ extensions: { vector } });
    await migrate(drizzle(fresh), { migrationsFolder: MIGRATIONS_FOLDER });
    return fresh;
  }
}

const db = drizzle(await migratedDatabase(), { schema });

export { db };
