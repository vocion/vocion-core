import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkPage } from '../src/web/pages.mjs';
import { byTestId, storeAt, text } from './helpers.mjs';

test('A1: the visitor sees who shared it', () => {
  const html = linkPage(storeAt(), 'l1', { viewer: 'cfo@kestrel.example' });
  assert.equal(text(byTestId(html, 'shared-by')[0]), 'Shared by Owner');
  assert.ok(html.indexOf('data-testid="shared-by"') > html.indexOf('data-testid="title"'));
});

test('A2: no owner record reads Shared with you', () => {
  const store = storeAt();
  store.db.users = store.db.users.filter(u => u.id !== 'u_owner');
  assert.equal(text(byTestId(linkPage(store, 'l1'), 'shared-by')[0]), 'Shared with you');
});
