import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

function meta(store, id) {
  return text(byTestId(documentPage(store, 'u_owner', id), 'doc-meta')[0]);
}

test('A1: d1 reads 18 pages and 2.4 MB', () => {
  assert.equal(meta(storeAt(), 'd1'), '18 pages \u00B7 2.4 MB');
});

test('A2: d2 reads 1 page and 48 KB', () => {
  assert.equal(meta(storeAt(), 'd2'), '1 page \u00B7 48 KB');
});

test('A3: d3 reads 980 KB', () => {
  assert.equal(meta(storeAt(), 'd3'), '12 pages \u00B7 980 KB');
});

test('A4: one million bytes reads 1.0 MB', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd5').sizeBytes = 1000000;
  assert.match(meta(store, 'd5'), /\b1\.0 MB$/);
});
