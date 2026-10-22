import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

test('A1: d1 reads 18 pages', () => {
  assert.match(text(byTestId(documentPage(storeAt(), 'u_owner', 'd1'), 'doc-meta')[0]), /\b18 pages\b/);
});

test('A2: a one-page document reads 1 page', () => {
  const meta = text(byTestId(documentPage(storeAt(), 'u_owner', 'd5'), 'doc-meta')[0]);
  assert.match(meta, /\b1 page\b/);
  assert.doesNotMatch(meta, /1 pages/);
});

test('A3: the count sits in the meta line after the title', () => {
  const html = documentPage(storeAt(), 'u_owner', 'd3');
  assert.ok(html.indexOf('data-testid="doc-meta"') > html.indexOf('data-testid="title"'));
  assert.match(text(byTestId(html, 'doc-meta')[0]), /12 pages/);
});
