import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage, libraryPage, linkPage } from '../src/web/pages.mjs';
import { api, byTestId, rowIds, rowsById, storeAt, text } from './helpers.mjs';

const act = (store, what, userId = 'u_owner', id = 'd1') => api(store, { method: 'POST', path: `/api/documents/${id}/${what}`, userId });

test('A1: owner only', () => {
  const store = storeAt();
  const r = act(store, 'archive', 'u_teammate');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'owner_only');
  assert.equal(act(storeAt(), 'archive', 'u_other').status, 404);
  assert.equal(act(store, 'archive').status, 200);
  assert.ok(store.findDocument('d1').archivedAt);
  assert.equal(act(store, 'unarchive').status, 200);
  assert.ok(!store.findDocument('d1').archivedAt);
});

test('A2: leaves the library unless shown', () => {
  const store = storeAt();
  act(store, 'archive');
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner')), ['d2', 'd5', 'd4', 'd3']);
  assert.deepEqual(api(store, { path: '/api/documents', userId: 'u_owner' }).body.documents.map(d => d.id), ['d2', 'd5', 'd4', 'd3']);
  const shown = libraryPage(store, 'u_owner', { showArchived: true });
  assert.ok(rowIds(shown).includes('d1'));
  assert.equal(byTestId(rowsById(shown).d1, 'mark-archived').length, 1);
  assert.equal(byTestId(rowsById(shown).d2, 'mark-archived').length, 0);
  assert.ok(api(store, { path: '/api/documents', query: { archived: '1' }, userId: 'u_owner' }).body.documents.some(d => d.id === 'd1'));
});

test('A3: links answer 410', () => {
  const store = storeAt();
  act(store, 'archive');
  const before = store.viewsFor('d1').length;
  const r = api(store, { path: '/l/l1', query: { viewer: 'cfo@kestrel.example' } });
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'archived');
  assert.doesNotMatch(JSON.stringify(r.body), /Board/);
  assert.equal(api(store, { path: '/l/l1/download' }).status, 410);
  assert.equal(store.viewsFor('d1').length, before);
});

test('A4: the visitor page', () => {
  const store = storeAt();
  act(store, 'archive');
  const html = linkPage(store, 'l1');
  assert.match(text(byTestId(html, 'unavailable')[0]), /This document is no longer available/);
  assert.doesNotMatch(text(html), /Q3 Board Deck/);
});

test('A5: unarchive restores', () => {
  const store = storeAt();
  act(store, 'archive');
  act(store, 'unarchive');
  assert.equal(api(store, { path: '/l/l1' }).status, 200);
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner')), ['d2', 'd1', 'd5', 'd4', 'd3']);
  assert.ok(documentPage(store, 'u_owner', 'd1'));
});
