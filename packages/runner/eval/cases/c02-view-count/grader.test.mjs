import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.mjs';
import { documentPage } from '../src/web/pages.mjs';

import { byTestId, storeAt, text } from './helpers.mjs';

function count(store, id) {
  return text(byTestId(documentPage(store, 'u_owner', id), 'view-count')[0]);
}

test('A1: d1 shows Viewed 4 times', () => {
  assert.equal(count(storeAt(), 'd1'), 'Viewed 4 times');
});

test('A2: one open reads Viewed 1 time', () => {
  assert.equal(count(storeAt(), 'd3'), 'Viewed 1 time');
});

test('A3: no opens reads Viewed 0 times', () => {
  assert.equal(count(storeAt(), 'd5'), 'Viewed 0 times');
});

test('A4: a new open raises the count', () => {
  const store = storeAt();
  handle(store, { path: '/l/l3', query: { viewer: 'new.hire@northwind.example' } });
  assert.equal(count(store, 'd3'), 'Viewed 2 times');
});
