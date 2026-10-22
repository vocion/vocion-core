import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowIds, storeAt, text } from './helpers.mjs';

test('A1: only sent and unopened', () => {
  assert.deepEqual(rowIds(libraryPage(storeAt(), 'u_owner', { notOpened: true })), ['d4']);
  const r = api(storeAt(), { path: '/api/documents', query: { notOpened: '1' }, userId: 'u_owner' });
  assert.deepEqual(r.body.documents.map(d => d.id), ['d4']);
});

test('A2: the owner opening their own link does not count', () => {
  const store = storeAt();
  api(store, { path: '/l/l4', userId: 'u_owner' });
  store.db.views.push({ docId: 'd4', linkId: 'l4', viewerId: 'u_owner', at: store.now() });
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner', { notOpened: true })), ['d4']);
});

test('A3: a visitor opening it does', () => {
  const store = storeAt();
  api(store, { path: '/l/l4', query: { viewer: 'legal@contoso.example' } });
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner', { notOpened: true })), []);
});

test('A4: the chip counts', () => {
  const store = storeAt();
  api(store, { method: 'POST', path: '/api/documents/d5/links', body: { recipientEmail: 'buyer@acme.example' }, userId: 'u_owner' });
  assert.equal(text(byTestId(libraryPage(store, 'u_owner'), 'filter-not-opened')[0]), 'Not opened yet (2)');
});

test('A5: empty state', () => {
  const store = storeAt();
  api(store, { path: '/l/l4', query: { viewer: 'legal@contoso.example' } });
  assert.match(text(byTestId(libraryPage(store, 'u_owner', { notOpened: true }), 'empty')[0]), /Every document you sent has been opened/);
});
