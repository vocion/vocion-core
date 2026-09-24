import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Migration 0143 against a populated column.
 *
 * Every other test replays the migrations onto an empty database, where this
 * one's ALTER has no rows to convert — and converting rows is the whole point:
 * a score written as 0.9 into a 32-bit `real` must come out as 0.9, not as the
 * 0.8999999761581421 a plain cast to double would keep.
 */

const MIGRATION_SQL = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/0143_eval_score_value_double.sql'),
  'utf8',
);

let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.exec(`CREATE TABLE "eval_score" ("id" serial PRIMARY KEY, "value" real)`);
});

afterEach(async () => {
  await database.close();
});

/**
 * The column's values in insertion order, and its type.
 * @param db - The database under test.
 */
async function readColumn(db: PGlite): Promise<{ type: string; values: Array<number | null> }> {
  const type = await db.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_name = 'eval_score' AND column_name = 'value'`,
  );
  const rows = await db.query<{ value: number | null }>(`SELECT "value" FROM "eval_score" ORDER BY "id"`);
  return { type: type.rows[0]!.data_type, values: rows.rows.map(row => row.value) };
}

describe('migration 0143: eval_score.value from real to double precision', () => {
  it('stores each existing score as the value it meant, not its 32-bit noise', async () => {
    await database.exec(`INSERT INTO "eval_score" ("value") VALUES (0.9), (0.29), (0.669), (NULL)`);

    await database.exec(MIGRATION_SQL);

    expect(await readColumn(database)).toEqual({ type: 'double precision', values: [0.9, 0.29, 0.669, null] });
  });

  it('changes nothing when it runs a second time', async () => {
    await database.exec(MIGRATION_SQL);
    // A score only a double can hold (0.1 + 0.2): a second numeric cast would cut it to 0.3.
    await database.exec(`INSERT INTO "eval_score" ("value") VALUES (0.30000000000000004)`);

    await database.exec(MIGRATION_SQL);

    expect((await readColumn(database)).values).toEqual([0.1 + 0.2]);
  });
});
