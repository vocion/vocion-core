/**
 * One migrated database, built once and restored by every test file that needs
 * one.
 *
 * 219 test files mock `@/libs/DB`, and that mock used to stand up its own
 * PGlite and replay every migration at module load. With 143 migrations that
 * was about 573ms per file — roughly two CPU-minutes of the same work, done
 * over and over, and it was the largest single cost in the suite. On a laptop
 * with sixteen cores it hid behind the parallelism; on CI's two it was most of
 * the run, and the job started being cancelled at its timeout with nothing
 * actually failing.
 *
 * So the migrations run once here, in vitest's global setup, and the finished
 * database is dumped to a file. Each test file loads that dump instead, which
 * measured at 123ms — the same schema, a fifth of the time.
 *
 * The dump lives under `node_modules/.cache` rather than a temp directory
 * because every worker has to find it by the same path without being told, and
 * because it is build output that should disappear with a clean install.
 */

import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/** Where this package's generated migrations live, resolved from this file. */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/**
 * The dump every test worker reads.
 *
 * Uncompressed on purpose: compressing saves disk we are not short of and
 * costs CPU on every one of the 219 reads, which is the thing being fixed.
 */
export const SNAPSHOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules/.cache/vocion/migrated-db.tar',
);

/**
 * Build the migrated database and write it where the test files will look.
 *
 * Vitest calls this once per run, before any test file is loaded.
 */
export default async function buildMigratedDatabaseSnapshot(): Promise<void> {
  // pgvector ships with PGlite as a bundled extension. It has to be registered
  // here as well as at restore time, or migration 0019's `CREATE EXTENSION
  // vector` fails against a database that has never heard of it.
  const database = new PGlite({ extensions: { vector } });
  await migrate(drizzle(database), { migrationsFolder: MIGRATIONS_FOLDER });
  const dump = await database.dumpDataDir('none');
  await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(SNAPSHOT_PATH, Buffer.from(await dump.arrayBuffer()));
  await database.close();
}
