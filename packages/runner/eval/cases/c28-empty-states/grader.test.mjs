import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

test('A1: an empty library', () => {
  const store = storeAt();
  store.db.documents = [];
  assert.equal(text(byTestId(libraryPage(store, 'u_owner'), 'empty')[0]), 'Your library is empty. Upload a document to share it.');
});

test('A2: no match', () => {
  const html = libraryPage(storeAt(), 'u_owner', { q: 'zebra' });
  assert.match(text(byTestId(html, 'empty')[0]), /No documents match "zebra"/);
  assert.match(byTestId(html, 'clear-search')[0], /href="\/"/);
});

test('A3: escaped', () => {
  const html = libraryPage(storeAt(), 'u_owner', { q: '<b>x</b>' });
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(text(byTestId(html, 'empty')[0]), /No documents match/);
});
