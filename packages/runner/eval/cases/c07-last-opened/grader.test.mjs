import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowsById, storeAt, text } from './helpers.mjs';

function last(store) {
  const rows = rowsById(libraryPage(store, 'u_owner'));
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, text(byTestId(r, 'last-opened')[0])]));
}

test('A1: d1 reads 2 hours ago', () => {
  assert.equal(last(storeAt()).d1, 'Last opened 2 hours ago');
});

test('A2: days round down', () => {
  const l = last(storeAt());
  assert.equal(l.d3, 'Last opened 6 days ago');
  assert.equal(l.d4, 'Last opened 10 days ago');
});

test('A3: never opened', () => {
  assert.equal(last(storeAt()).d5, 'Not opened yet');
});

test('A4: singular units and just now', () => {
  assert.equal(last(storeAt('2026-10-01T11:00:00.000Z')).d1, 'Last opened 1 hour ago');
  assert.equal(last(storeAt('2026-10-01T10:00:30.000Z')).d1, 'Last opened just now');
  assert.equal(last(storeAt('2026-10-01T10:01:00.000Z')).d1, 'Last opened 1 minute ago');
  assert.equal(last(storeAt('2026-09-26T09:00:00.000Z')).d3, 'Last opened 1 day ago');
});

test('A5: the API returns lastOpenedAt', () => {
  const docs = Object.fromEntries(api(storeAt(), { path: '/api/documents', userId: 'u_owner' }).body.documents.map(d => [d.id, d]));
  assert.equal(docs.d1.lastOpenedAt, '2026-10-01T10:00:00.000Z');
  assert.equal(docs.d5.lastOpenedAt, null);
});
