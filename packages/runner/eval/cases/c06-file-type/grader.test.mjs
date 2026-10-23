import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

function meta(store, id) {
  return text(byTestId(documentPage(store, 'u_owner', id), 'doc-meta')[0]);
}

test('A1: d1 reads 18 pages and PDF', () => {
  assert.equal(meta(storeAt(), 'd1'), '18 pages \u00B7 PDF');
});

test('A2: Word and Excel', () => {
  assert.equal(meta(storeAt(), 'd4'), '4 pages \u00B7 Word');
  assert.equal(meta(storeAt(), 'd2'), '1 page \u00B7 Excel');
});

test('A3: PowerPoint and unknown types', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd3').mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  store.db.documents.find(d => d.id === 'd5').mimeType = 'application/x-unknown';
  assert.equal(meta(store, 'd3'), '12 pages \u00B7 PowerPoint');
  assert.equal(meta(store, 'd5'), '1 page \u00B7 File');
});
