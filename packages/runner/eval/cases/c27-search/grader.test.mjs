import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { api, rowIds, storeAt } from './helpers.mjs';

const ids = q => api(storeAt(), { path: '/api/documents', query: { q }, userId: 'u_owner' }).body.documents.map(d => d.id);

test('A1: case and spaces', () => {
  assert.deepEqual(ids('board'), ['d1']);
  assert.deepEqual(ids('  BOARD '), ['d1']);
  assert.deepEqual(rowIds(libraryPage(storeAt(), 'u_owner', { q: 'board' })), ['d1']);
});

test('A2: every word, any order', () => {
  assert.deepEqual(ids('deck q3'), ['d1']);
  assert.deepEqual(ids('onboard'), ['d3']);
  assert.deepEqual(ids('deck pricing'), []);
});

test('A3: blank shows everything', () => {
  assert.equal(ids('   ').length, 5);
});
