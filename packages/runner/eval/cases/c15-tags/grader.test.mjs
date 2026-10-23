import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowIds, rowsById, storeAt, text } from './helpers.mjs';

const put = (store, tags, userId = 'u_owner', id = 'd1') => api(store, { method: 'PUT', path: `/api/documents/${id}/tags`, body: { tags }, userId });

test('A1: the rules', () => {
  const store = storeAt();
  assert.equal(put(store, [' Board ', 'Q3', 'board']).status, 200);
  assert.deepEqual(store.findDocument('d1').tags, ['Board', 'Q3']);
  assert.equal(put(store, ['   ']).body.error, 'invalid_tag');
  assert.equal(put(store, ['x'.repeat(25)]).status, 400);
  assert.equal(put(store, Array.from({ length: 11 }, (_, i) => `t${i}`)).body.error, 'too_many_tags');
  assert.deepEqual(store.findDocument('d1').tags, ['Board', 'Q3']);
});

test('A2: shared, and in the API', () => {
  const store = storeAt();
  put(store, ['Board']);
  const docs = api(store, { path: '/api/documents', userId: 'u_teammate' }).body.documents;
  assert.deepEqual(docs.find(d => d.id === 'd1').tags, ['Board']);
  assert.deepEqual(docs.find(d => d.id === 'd2').tags, []);
});

test('A3: chips', () => {
  const store = storeAt();
  put(store, ['Board', 'Q3']);
  const rows = rowsById(libraryPage(store, 'u_teammate'));
  assert.deepEqual(byTestId(rows.d1, 'tag-chip').map(text), ['Board', 'Q3']);
  assert.deepEqual(byTestId(rows.d2, 'tag-chip'), []);
});

test('A4: filter and clear', () => {
  const store = storeAt();
  put(store, ['Board']);
  put(store, ['Draft'], 'u_owner', 'd4');
  const html = libraryPage(store, 'u_owner', { tag: 'board' });
  assert.deepEqual(rowIds(html), ['d1']);
  assert.match(byTestId(html, 'clear-tag')[0], /href="\/"/);
  assert.equal(byTestId(libraryPage(store, 'u_owner'), 'clear-tag').length, 0);
  assert.deepEqual(api(store, { path: '/api/documents', query: { tag: 'DRAFT' }, userId: 'u_owner' }).body.documents.map(d => d.id), ['d4']);
});

test('A5: non-members cannot tag', () => {
  assert.equal(put(storeAt(), ['x'], 'u_other').status, 404);
});
