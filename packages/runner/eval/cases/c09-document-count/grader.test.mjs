import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

function count(html) {
  return byTestId(html, 'doc-count').map(text);
}

test('A1: 5 documents above the list', () => {
  const html = libraryPage(storeAt(), 'u_owner');
  assert.deepEqual(count(html), ['5 documents']);
  assert.ok(html.indexOf('data-testid="doc-count"') < html.indexOf('data-testid="doc-row"'));
});

test('A2: under a search', () => {
  assert.deepEqual(count(libraryPage(storeAt(), 'u_owner', { q: 'Board' })), ['1 of 5 documents']);
});

test('A3: one document', () => {
  assert.deepEqual(count(libraryPage(storeAt(), 'u_other')), ['1 document']);
});

test('A4: an empty library', () => {
  const store = storeAt();
  store.db.documents = store.db.documents.filter(d => d.libraryId !== 'lib_team');
  const html = libraryPage(store, 'u_owner');
  assert.deepEqual(count(html), []);
  assert.doesNotMatch(text(html), /0 documents/);
  assert.equal(byTestId(html, 'empty').length, 1);
});
