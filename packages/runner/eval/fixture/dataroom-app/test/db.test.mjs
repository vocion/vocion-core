import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from '../src/db/database.mjs';
import { migrate, MIGRATIONS } from '../src/db/migrations/index.mjs';
import { seed } from '../src/db/seed.mjs';

test('migrations run in order, once, and the schema refuses unknown columns', () => {
  const db = createDatabase();
  assert.deepEqual(migrate(db), MIGRATIONS.map(m => m.version));
  assert.deepEqual(migrate(db), []);
  assert.throws(() => db.insert('documents', { id: 'x', colour: 'red' }), /no column colour/);
});

test('a database at version 2 upgrades with its data', () => {
  const db = createDatabase();
  migrate(db, { to: 2 });
  assert.equal(db.hasColumn('documents', 'archivedAt'), false);
  migrate(db);
  seed(db);
  assert.equal(db.find('documents', 'd1').archivedAt, null);
  assert.equal(db.find('links', 'l1').allowDownload, true);
});
