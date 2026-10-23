import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

function uploaded(store, id) {
  return text(byTestId(documentPage(store, 'u_owner', id), 'uploaded')[0]);
}

test('A1: d1 reads Uploaded Sep 30 under its title', () => {
  const html = documentPage(storeAt(), 'u_owner', 'd1');
  assert.equal(uploaded(storeAt(), 'd1'), 'Uploaded Sep 30');
  assert.ok(html.indexOf('data-testid="uploaded"') > html.indexOf('data-testid="title"'));
});

test('A2: an earlier year shows the year', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd3').uploadedAt = '2025-09-30T10:00:00.000Z';
  assert.equal(uploaded(store, 'd3'), 'Uploaded Sep 30, 2025');
});

test('A3: the date is UTC', () => {
  const store = storeAt();
  store.db.documents.find(d => d.id === 'd3').uploadedAt = '2026-09-12T23:30:00.000Z';
  assert.equal(uploaded(store, 'd3'), 'Uploaded Sep 12');
});
