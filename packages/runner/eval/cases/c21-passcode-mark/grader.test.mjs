import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage, libraryPage, linkPage } from '../src/web/pages.mjs';
import { api, byTestId, rowsById, storeAt, text } from './helpers.mjs';

const protect = (store, link = 'l1', doc = 'd1') => api(store, { method: 'PUT', path: `/api/documents/${doc}/links/${link}/passcode`, body: { passcode: 'tiger42' }, userId: 'u_owner' });

test('A1: the mark', () => {
  const store = storeAt();
  protect(store);
  const rows = rowsById(libraryPage(store, 'u_owner'));
  assert.deepEqual(byTestId(rows.d1, 'mark-passcode').map(text), ['Passcode']);
  assert.deepEqual(byTestId(rows.d3, 'mark-passcode'), []);
});

test('A2: the link row', () => {
  const store = storeAt();
  protect(store);
  const rows = byTestId(documentPage(store, 'u_owner', 'd1'), 'link-row');
  assert.match(text(rows.find(r => r.includes('data-id="l1"'))), /Passcode/);
  assert.doesNotMatch(text(rows.find(r => r.includes('data-id="l2"'))), /Passcode/);
});

test('A3: members are never asked', () => {
  const store = storeAt();
  protect(store);
  const r = api(store, { path: '/l/l1', userId: 'u_owner' });
  assert.equal(r.status, 200);
  assert.equal(api(store, { path: '/l/l1', userId: 'u_teammate' }).status, 200);
  assert.equal(store.viewsFor('d1').at(-1).viewerId, 'u_teammate');
  const html = linkPage(store, 'l1', { userId: 'u_owner' });
  assert.match(text(html), /Q3 Board Deck/);
  assert.equal(byTestId(html, 'passcode-form').length, 0);
});

test('A4: others are still asked', () => {
  const store = storeAt();
  protect(store);
  assert.equal(api(store, { path: '/l/l1', userId: 'u_other' }).status, 401);
  assert.equal(api(store, { path: '/l/l1' }).status, 401);
  assert.equal(byTestId(linkPage(store, 'l1', { userId: 'u_other' }), 'passcode-form').length, 1);
});
