import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../src/store.mjs';
import { documentPage, libraryPage, linkPage } from '../src/web/pages.mjs';
import { byTestId, text } from './helpers.mjs';

test('the library page shows one row per document', () => {
  assert.equal(byTestId(libraryPage(createStore(), 'u_owner'), 'doc-row').length, 5);
});

test('a search narrows the library by title', () => {
  const rows = byTestId(libraryPage(createStore(), 'u_owner', { q: 'Board' }), 'doc-row');
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /Q3 Board Deck/);
});

test('the document page names the document and its links', () => {
  const html = documentPage(createStore(), 'u_owner', 'd1');
  assert.equal(text(byTestId(html, 'title')[0]), 'Q3 Board Deck');
  assert.equal(byTestId(html, 'link-row').length, 2);
});

test('the document page is not shown outside the library', () => {
  assert.equal(documentPage(createStore(), 'u_other', 'd1'), null);
});

test('the link page offers the download', () => {
  assert.equal(byTestId(linkPage(createStore(), 'l1'), 'download').length, 1);
});
