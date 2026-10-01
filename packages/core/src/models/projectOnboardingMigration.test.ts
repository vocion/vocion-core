import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Migration 0161 against workspaces that already exist.
 *
 * Setup opens by itself while `onboarding_started_at` is null. Without a
 * backfill, every workspace already in production would open a setup
 * conversation on its first admin visit after the deploy. And because
 * `infra/aws/migrate.sh` replays every migration on every deploy, a backfill
 * that ran each time would mark each new workspace as started before anyone
 * opened it. The tests pin both halves.
 */

const MIGRATION_SQL = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/0161_project_onboarding.sql'),
  'utf8',
);

let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.exec(`CREATE TABLE "project" ("id" text PRIMARY KEY)`);
});

afterEach(async () => {
  await database.close();
});

/**
 * Each project's onboarding columns, ordered by id.
 * @param db - The database under test.
 */
async function readOnboarding(db: PGlite): Promise<Array<{ id: string; started: boolean; startedBy: string | null }>> {
  const rows = await db.query<{ id: string; started: boolean; started_by: string | null }>(
    `SELECT "id", "onboarding_started_at" IS NOT NULL AS "started", "onboarding_started_by" AS "started_by" FROM "project" ORDER BY "id"`,
  );
  return rows.rows.map(row => ({ id: row.id, started: row.started, startedBy: row.started_by }));
}

describe('migration 0161: project onboarding columns', () => {
  it('marks every workspace that existed before setup shipped as started, so a mature workspace never pops setup', async () => {
    await database.exec(`INSERT INTO "project" ("id") VALUES ('proj_revops'), ('proj_factory')`);

    await database.exec(MIGRATION_SQL);

    expect(await readOnboarding(database)).toEqual([
      { id: 'proj_factory', started: true, startedBy: 'backfill:0161' },
      { id: 'proj_revops', started: true, startedBy: 'backfill:0161' },
    ]);
  });

  it('leaves a workspace created after the deploy unstarted when the next deploy replays the file', async () => {
    await database.exec(MIGRATION_SQL);
    await database.exec(`INSERT INTO "project" ("id") VALUES ('proj_new')`);

    await database.exec(MIGRATION_SQL);

    expect(await readOnboarding(database)).toEqual([{ id: 'proj_new', started: false, startedBy: null }]);
  });
});
