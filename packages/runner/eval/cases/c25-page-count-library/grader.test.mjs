import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { byTestId, rowsById, storeAt, text } from './helpers.mjs';

test('A1: every row shows a page count', () => {
  const rows = Object.values(rowsById(libraryPage(storeAt(), 'u_owner')));
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.match(text(byTestId(row, 'pages')[0]), /^\d+ pages?$/);
  }
});

test('A2: d1 and d5 read their counts', () => {
  const rows = rowsById(libraryPage(storeAt(), 'u_owner'));
  assert.equal(text(byTestId(rows.d1, 'pages')[0]), '18 pages');
  assert.equal(text(byTestId(rows.d5, 'pages')[0]), '1 page');
});
