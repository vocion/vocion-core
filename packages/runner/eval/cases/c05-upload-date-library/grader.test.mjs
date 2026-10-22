import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { byTestId, rowsById, storeAt, text } from './helpers.mjs';

function uploaded(row) {
  return text(byTestId(row, 'uploaded')[0]);
}

test('A1: every row shows an upload date after its title', () => {
  const rows = Object.values(rowsById(libraryPage(storeAt(), 'u_owner')));
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.match(uploaded(row), /^Uploaded [A-Z][a-z]{2} \d{1,2}/);
    assert.ok(row.indexOf('data-testid="uploaded"') > row.indexOf('class="title"'));
  }
});

test('A2: d1 and d3 read their dates', () => {
  const rows = rowsById(libraryPage(storeAt(), 'u_owner'));
  assert.equal(uploaded(rows.d1), 'Uploaded Sep 30');
  assert.equal(uploaded(rows.d3), 'Uploaded Sep 12');
});

test('A3: an earlier year shows the year', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd3').uploadedAt = '2025-12-31T23:00:00.000Z';
  assert.equal(uploaded(rowsById(libraryPage(store, 'u_owner')).d3), 'Uploaded Dec 31, 2025');
});
