import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkPage } from '../src/web/pages.mjs';
import { api, byTestId, storeAt, text } from './helpers.mjs';

const set = (store, passcode, userId = 'u_owner') => api(store, { method: 'PUT', path: '/api/documents/d1/links/l1/passcode', body: { passcode }, userId });

test('A1: set and remove, length enforced', () => {
  const store = storeAt();
  assert.equal(set(store, 'abc').status, 400);
  assert.equal(set(store, 'abc').body.error, 'invalid_passcode');
  assert.equal(set(store, 'x'.repeat(33)).status, 400);
  assert.equal(set(store, 'tiger42').status, 200);
  assert.equal(set(storeAt(), 'tiger42', 'u_other').status, 404);
  assert.equal(api(store, { path: '/l/l1' }).status, 401);
  assert.equal(api(store, { method: 'DELETE', path: '/api/documents/d1/links/l1/passcode', userId: 'u_teammate' }).status, 200);
  assert.equal(api(store, { path: '/l/l1' }).status, 200);
});

test('A2: hashed, never returned', () => {
  const store = storeAt();
  set(store, 'tiger42');
  assert.doesNotMatch(JSON.stringify(store.db), /tiger42/);
  const links = api(store, { path: '/api/documents/d1/links', userId: 'u_owner' }).body.links;
  assert.doesNotMatch(JSON.stringify(links), /tiger42/);
  assert.equal(links.find(l => l.id === 'l1').hasPasscode, true);
  assert.equal(links.find(l => l.id === 'l2').hasPasscode, false);
});

test('A3: locked without or with a wrong passcode', () => {
  const store = storeAt();
  set(store, 'tiger42');
  const none = api(store, { path: '/l/l1', query: { viewer: 'cfo@kestrel.example' } });
  assert.equal(none.status, 401);
  assert.equal(none.body.error, 'passcode_required');
  assert.doesNotMatch(JSON.stringify(none.body), /Board/);
  const wrong = api(store, { path: '/l/l1', query: { passcode: 'lion' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'passcode_invalid');
});

test('A4: the right passcode opens, and only then counts', () => {
  const store = storeAt();
  set(store, 'tiger42');
  const before = store.viewsFor('d1').length;
  api(store, { path: '/l/l1', query: { passcode: 'nope' } });
  assert.equal(store.viewsFor('d1').length, before);
  const ok = api(store, { path: '/l/l1', query: { passcode: 'tiger42', viewer: 'cfo@kestrel.example' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.document.title, 'Q3 Board Deck');
  assert.equal(store.viewsFor('d1').length, before + 1);
});

test('A5: the download follows the rule', () => {
  const store = storeAt();
  set(store, 'tiger42');
  assert.equal(api(store, { path: '/l/l1/download' }).status, 401);
  assert.equal(api(store, { path: '/l/l1/download', query: { passcode: 'tiger42' } }).status, 200);
});

test('A6: the visitor page asks first', () => {
  const store = storeAt();
  set(store, 'tiger42');
  const locked = linkPage(store, 'l1', { viewer: 'cfo@kestrel.example' });
  assert.equal(byTestId(locked, 'passcode-form').length, 1);
  assert.doesNotMatch(text(locked), /Q3 Board Deck/);
  const open = linkPage(store, 'l1', { viewer: 'cfo@kestrel.example', passcode: 'tiger42' });
  assert.match(text(open), /Q3 Board Deck/);
});
