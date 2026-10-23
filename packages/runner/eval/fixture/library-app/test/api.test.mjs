import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from '../src/api.mjs';
import { createStore } from '../src/store.mjs';

test('the library lists the documents of the libraries a person is in, newest first', () => {
  const r = handle(createStore(), { path: '/api/documents', userId: 'u_teammate' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.documents.map(d => d.id), ['d2', 'd1', 'd5', 'd4', 'd3']);
});

test('the library needs a signed-in person', () => {
  assert.equal(handle(createStore(), { path: '/api/documents' }).status, 401);
});

test('a link is created for a recipient and opens for a visitor, who is counted', () => {
  const store = createStore();
  const made = handle(store, { method: 'POST', path: '/api/documents/d5/links', body: { recipientEmail: 'buyer@acme.example' }, userId: 'u_owner' });
  assert.equal(made.status, 201);
  const opened = handle(store, { path: `/l/${made.body.link.id}`, query: { viewer: 'buyer@acme.example' } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.document.title, 'Product One-Pager');
  assert.equal(store.viewsFor('d5').length, 1);
});

test('a link needs a recipient email', () => {
  const r = handle(createStore(), { method: 'POST', path: '/api/documents/d5/links', body: {}, userId: 'u_owner' });
  assert.equal(r.status, 400);
});

test('an unknown link is not found', () => {
  assert.equal(handle(createStore(), { path: '/l/nope' }).status, 404);
});
