import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowIds, rowsById, storeAt } from './helpers.mjs';

const star = (store, userId, id, starred = true) => api(store, { method: 'PUT', path: `/api/documents/${id}/star`, body: { starred }, userId });

test('A1: starred first, in the order starred', () => {
  const store = storeAt();
  assert.equal(star(store, 'u_owner', 'd3').status, 200);
  store.db.now = '2026-10-01T12:05:00.000Z';
  star(store, 'u_owner', 'd5');
  const html = libraryPage(store, 'u_owner');
  assert.deepEqual(rowIds(html), ['d3', 'd5', 'd2', 'd1', 'd4']);
  assert.equal(byTestId(html, 'starred-heading').length, 1);
});

test('A2: unstar returns it', () => {
  const store = storeAt();
  star(store, 'u_owner', 'd3');
  star(store, 'u_owner', 'd3', false);
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner')), ['d2', 'd1', 'd5', 'd4', 'd3']);
  assert.equal(byTestId(libraryPage(store, 'u_owner'), 'starred-heading').length, 0);
});

test('A3: per person', () => {
  const store = storeAt();
  star(store, 'u_owner', 'd3');
  assert.deepEqual(rowIds(libraryPage(store, 'u_teammate')), ['d2', 'd1', 'd5', 'd4', 'd3']);
});

test('A4: API and filter', () => {
  const store = storeAt();
  star(store, 'u_owner', 'd4');
  const docs = api(store, { path: '/api/documents', userId: 'u_owner' }).body.documents;
  assert.equal(docs.find(d => d.id === 'd4').starred, true);
  assert.equal(docs.find(d => d.id === 'd1').starred, false);
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner', { starred: true })), ['d4']);
  const filtered = api(store, { path: '/api/documents', query: { starred: '1' }, userId: 'u_owner' }).body.documents;
  assert.deepEqual(filtered.map(d => d.id), ['d4']);
});

test('A5: the star control shows its state', () => {
  const store = storeAt();
  star(store, 'u_owner', 'd4');
  const rows = rowsById(libraryPage(store, 'u_owner'));
  assert.match(byTestId(rows.d4, 'star')[0], /aria-pressed="true"/);
  assert.match(byTestId(rows.d1, 'star')[0], /aria-pressed="false"/);
});
