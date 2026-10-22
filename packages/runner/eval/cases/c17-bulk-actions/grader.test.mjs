import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowsById, storeAt } from './helpers.mjs';

const bulk = (store, ids, action, userId = 'u_owner') => api(store, { method: 'POST', path: '/api/documents/bulk', body: { ids, action }, userId });
const starredIds = (store, userId = 'u_owner') => api(store, { path: '/api/documents', query: { starred: '1' }, userId }).body.documents.map(d => d.id).sort();

test('A1: star several, undo', () => {
  const store = storeAt();
  const r = bulk(store, ['d1', 'd3'], 'star');
  assert.equal(r.status, 200);
  assert.deepEqual(starredIds(store), ['d1', 'd3']);
  assert.deepEqual(r.body.undo.action, 'unstar');
  assert.deepEqual([...r.body.undo.ids].sort(), ['d1', 'd3']);
  bulk(store, r.body.undo.ids, r.body.undo.action);
  assert.deepEqual(starredIds(store), []);
});

test('A2: archive several, owner rule, undo', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd5').ownerId = 'u_teammate';
  const r = bulk(store, ['d1', 'd5'], 'archive');
  const byId = Object.fromEntries(r.body.results.map(x => [x.id, x]));
  assert.equal(byId.d1.ok, true);
  assert.equal(byId.d5.ok, false);
  assert.ok(store.findDocument('d1').archivedAt);
  assert.ok(!store.findDocument('d5').archivedAt);
  assert.deepEqual(r.body.undo, { action: 'unarchive', ids: ['d1'] });
  bulk(store, r.body.undo.ids, r.body.undo.action);
  assert.ok(!store.findDocument('d1').archivedAt);
});

test('A3: other libraries are left alone', () => {
  const store = storeAt();
  const r = bulk(store, ['d1', 'd6'], 'star');
  const d6 = r.body.results.find(x => x.id === 'd6');
  assert.equal(d6.ok, false);
  assert.equal(d6.error, 'not_found');
  assert.deepEqual(starredIds(store, 'u_other'), []);
});

test('A4: copy links', () => {
  const r = bulk(storeAt(), ['d3', 'd1'], 'copy-links');
  assert.deepEqual(r.body.text.split('\n'), ['Onboarding Guide: /l/l3', 'Q3 Board Deck: /l/l1', 'Q3 Board Deck: /l/l2']);
  assert.equal(r.body.undo, null);
});

test('A5: a checkbox per row', () => {
  const rows = rowsById(libraryPage(storeAt(), 'u_owner'));
  for (const [id, row] of Object.entries(rows)) {
    const box = byTestId(row, 'select')[0] || '';
    assert.match(box, /type="checkbox"/, id);
    assert.match(box, new RegExp(`value="${id}"`), id);
  }
});
