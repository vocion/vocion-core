import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowsById, storeAt, text } from './helpers.mjs';

function openedBy(store) {
  const rows = rowsById(libraryPage(store, 'u_owner'));
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, text(byTestId(r, 'opened-by')[0])]));
}

test('A1: distinct people, owner excluded', () => {
  assert.equal(openedBy(storeAt()).d1, 'Opened by 2');
});

test('A2: a teammate counts', () => {
  assert.equal(openedBy(storeAt()).d2, 'Opened by 1');
});

test('A3: not opened', () => {
  const o = openedBy(storeAt());
  assert.equal(o.d4, 'Not opened');
  assert.equal(o.d5, 'Not opened');
  const store = storeAt();
  api(store, { path: '/l/l4', userId: 'u_owner' });
  assert.equal(openedBy(store).d4, 'Not opened');
});

test('A4: the API', () => {
  const docs = Object.fromEntries(api(storeAt(), { path: '/api/documents', userId: 'u_owner' }).body.documents.map(d => [d.id, d]));
  assert.equal(docs.d1.openedBy, 2);
  assert.equal(docs.d4.openedBy, 0);
});
