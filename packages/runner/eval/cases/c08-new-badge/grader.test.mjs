import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { byTestId, rowsById, storeAt, text } from './helpers.mjs';

function badges(store) {
  const rows = rowsById(libraryPage(store, 'u_owner'));
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, byTestId(r, 'badge-new').map(text)]));
}

test('A1: d2 shows New', () => {
  assert.deepEqual(badges(storeAt()).d2, ['New']);
});

test('A2: older documents show none', () => {
  const b = badges(storeAt());
  for (const id of ['d1', 'd3', 'd4', 'd5']) {
    assert.deepEqual(b[id], [], id);
  }
});

test('A3: the 24 hour edge', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd5').uploadedAt = '2026-09-30T12:00:00.000Z';
  store.db.documents.find(d => d.id === 'd3').uploadedAt = '2026-09-30T12:01:00.000Z';
  const b = badges(store);
  assert.deepEqual(b.d5, []);
  assert.deepEqual(b.d3, ['New']);
});

test('A4: the badge follows the store clock', () => {
  assert.deepEqual(badges(storeAt('2026-10-03T12:00:00.000Z')).d2, []);
});
