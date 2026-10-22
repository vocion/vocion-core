import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowIds, storeAt, text } from './helpers.mjs';

test('A1: by name', () => {
  assert.deepEqual(rowIds(libraryPage(storeAt(), 'u_owner', { sort: 'name' })), ['d4', 'd3', 'd2', 'd5', 'd1']);
  const r = api(storeAt(), { path: '/api/documents', query: { sort: 'name' }, userId: 'u_owner' });
  assert.deepEqual(r.body.documents.map(d => d.id), ['d4', 'd3', 'd2', 'd5', 'd1']);
});

test('A2: the default', () => {
  assert.deepEqual(rowIds(libraryPage(storeAt(), 'u_owner')), ['d2', 'd1', 'd5', 'd4', 'd3']);
});

test('A3: by last opened', () => {
  assert.deepEqual(rowIds(libraryPage(storeAt(), 'u_owner', { sort: 'opened' })), ['d1', 'd2', 'd3', 'd4', 'd5']);
});

test('A4: remembered per person', () => {
  const store = storeAt();
  libraryPage(store, 'u_owner', { sort: 'name' });
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner')), ['d4', 'd3', 'd2', 'd5', 'd1']);
  assert.deepEqual(rowIds(libraryPage(store, 'u_teammate')), ['d2', 'd1', 'd5', 'd4', 'd3']);
  assert.deepEqual(rowIds(libraryPage(store, 'u_owner', { sort: 'bogus' })), ['d4', 'd3', 'd2', 'd5', 'd1']);
});

test('A5: the page names the sort', () => {
  assert.match(text(byTestId(libraryPage(storeAt(), 'u_owner', { sort: 'opened' }), 'sort')[0]), /Last opened/);
  assert.match(text(byTestId(libraryPage(storeAt(), 'u_owner'), 'sort')[0]), /Uploaded/);
});
