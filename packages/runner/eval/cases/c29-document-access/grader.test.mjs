import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, storeAt } from './helpers.mjs';

test('A1: 404 for a non-member, like a missing id', () => {
  const r = api(storeAt(), { path: '/api/documents/d1', userId: 'u_other' });
  const missing = api(storeAt(), { path: '/api/documents/nope', userId: 'u_other' });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, missing.body);
  assert.doesNotMatch(JSON.stringify(r.body), /Board/);
});

test('A2: links are closed too', () => {
  const store = storeAt();
  assert.equal(api(store, { path: '/api/documents/d1/links', userId: 'u_other' }).status, 404);
  assert.equal(api(store, { method: 'POST', path: '/api/documents/d1/links', body: { recipientEmail: 'x@acme.example' }, userId: 'u_other' }).status, 404);
  assert.equal(store.linksFor('d1').length, 2);
});

test('A3: members still read', () => {
  assert.equal(api(storeAt(), { path: '/api/documents/d1', userId: 'u_teammate' }).status, 200);
  assert.equal(api(storeAt(), { path: '/api/documents/d1/links', userId: 'u_teammate' }).body.links.length, 2);
});

test('A4: signed out', () => {
  assert.equal(api(storeAt(), { path: '/api/documents/d1' }).status, 401);
});
