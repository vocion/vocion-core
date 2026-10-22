import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage, libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, storeAt, text } from './helpers.mjs';

const patch = (store, userId, title) => api(store, { method: 'PATCH', path: '/api/documents/d1', body: { title }, userId });

test('A1: the new name shows everywhere', () => {
  const store = storeAt();
  assert.equal(patch(store, 'u_owner', '  Q3 Board Deck v2  ').status, 200);
  assert.match(text(libraryPage(store, 'u_owner')), /Q3 Board Deck v2/);
  assert.equal(text(byTestId(documentPage(store, 'u_owner', 'd1'), 'title')[0]), 'Q3 Board Deck v2');
  assert.equal(api(store, { path: '/api/documents/d1', userId: 'u_owner' }).body.document.title, 'Q3 Board Deck v2');
});

test('A2: a blank name is not saved', () => {
  const store = storeAt();
  const r = patch(store, 'u_owner', '   ');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'title_required');
  assert.equal(store.findDocument('d1').title, 'Q3 Board Deck');
});

test('A3: too long', () => {
  const r = patch(storeAt(), 'u_owner', 'x'.repeat(121));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'title_too_long');
  assert.equal(patch(storeAt(), 'u_owner', 'y'.repeat(120)).status, 200);
});

test('A4: a teammate cannot rename', () => {
  const store = storeAt();
  const r = patch(store, 'u_teammate', 'Mine now');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'owner_only');
  assert.equal(store.findDocument('d1').title, 'Q3 Board Deck');
});

test('A5: only the owner sees it editable', () => {
  assert.match(byTestId(documentPage(storeAt(), 'u_owner', 'd1'), 'title')[0], /data-editable="true"/);
  assert.doesNotMatch(byTestId(documentPage(storeAt(), 'u_teammate', 'd1'), 'title')[0], /data-editable="true"/);
});
