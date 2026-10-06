import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Migration 0167 against keys that already exist.
 *
 * Every `api_token` row written before logins were stored here was a pasted
 * key, so each one has to read as `paste` with no account. And because
 * `infra/aws/migrate.sh` replays every migration on every deploy, running the
 * file a second time must neither fail nor disturb a row that has since been
 * marked as a login.
 */

const MIGRATION_SQL = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/0167_api_token_login.sql'),
  'utf8',
);

let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.exec(`CREATE TABLE "api_token" ("id" text PRIMARY KEY, "platform" text NOT NULL)`);
});

afterEach(async () => {
  await database.close();
});

/**
 * Each row's provenance columns, ordered by id.
 * @param db - The database under test.
 */
async function readProvenance(db: PGlite): Promise<Array<{ id: string; obtainedVia: string; account: string | null }>> {
  const rows = await db.query<{ id: string; obtained_via: string; account: string | null }>(
    `SELECT "id", "obtained_via", "account" FROM "api_token" ORDER BY "id"`,
  );
  return rows.rows.map(row => ({ id: row.id, obtainedVia: row.obtained_via, account: row.account }));
}

describe('migration 0167: api_token login provenance', () => {
  it('reads every key pasted before this migration as a paste with no account', async () => {
    await database.exec(`INSERT INTO "api_token" ("id", "platform") VALUES ('tok_a', 'openai'), ('tok_b', 'github')`);

    await database.exec(MIGRATION_SQL);

    expect(await readProvenance(database)).toEqual([
      { id: 'tok_a', obtainedVia: 'paste', account: null },
      { id: 'tok_b', obtainedVia: 'paste', account: null },
    ]);
  });

  it('leaves a stored login untouched when the next deploy replays the file', async () => {
    await database.exec(MIGRATION_SQL);
    await database.exec(`INSERT INTO "api_token" ("id", "platform", "obtained_via", "account") VALUES ('tok_login', 'slack', 'login', 'Northwind')`);

    await database.exec(MIGRATION_SQL);

    expect(await readProvenance(database)).toEqual([{ id: 'tok_login', obtainedVia: 'login', account: 'Northwind' }]);
  });
});
