import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage, linkPage } from '../src/web/pages.mjs';
import { api, byTestId, storeAt, text } from './helpers.mjs';

const patch = (store, body, userId = 'u_owner', link = 'l3', doc = 'd3') => api(store, { method: 'PATCH', path: `/api/documents/${doc}/links/${link}`, body, userId });

test('A1: set, clear, validate', () => {
  const store = storeAt();
  assert.equal(patch(store, { expiresAt: '2026-10-05T00:00:00.000Z' }).status, 200);
  assert.equal(patch(store, { expiresAt: '2026-09-01T00:00:00.000Z' }).body.error, 'invalid_expiry');
  assert.equal(patch(store, { expiresAt: 'soon' }).status, 400);
  assert.equal(patch(store, { maxOpens: 0 }).body.error, 'invalid_max_opens');
  assert.equal(patch(store, { maxOpens: 1.5 }).status, 400);
  assert.equal(patch(store, { maxOpens: 3 }).status, 200);
  assert.equal(patch(store, { expiresAt: null, maxOpens: null }).status, 200);
  assert.equal(patch(storeAt(), { maxOpens: 3 }, 'u_other').status, 404);
});

test('A2: expired by time', () => {
  const store = storeAt();
  patch(store, { expiresAt: '2026-10-02T00:00:00.000Z' });
  assert.equal(api(store, { path: '/l/l3' }).status, 200);
  store.db.now = '2026-10-02T00:00:00.000Z';
  const before = store.viewsFor('d3').length;
  const r = api(store, { path: '/l/l3' });
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'expired');
  assert.doesNotMatch(JSON.stringify(r.body), /Onboarding/);
  assert.equal(api(store, { path: '/l/l3/download' }).status, 410);
  assert.equal(store.viewsFor('d3').length, before);
});

test('A3: the open limit', () => {
  const store = storeAt();
  patch(store, { maxOpens: 2 }, 'u_owner', 'l2', 'd1');
  assert.equal(api(store, { path: '/l/l2' }).status, 200);
  assert.equal(api(store, { path: '/l/l2' }).status, 410);
  const fresh = storeAt();
  patch(fresh, { maxOpens: 3 }, 'u_owner', 'l2', 'd1');
  assert.equal(api(fresh, { path: '/l/l2' }).status, 200);
  assert.equal(api(fresh, { path: '/l/l2' }).status, 200);
  assert.equal(api(fresh, { path: '/l/l2' }).status, 410);
});

test('A4: the visitor page', () => {
  const store = storeAt();
  patch(store, { maxOpens: 1 });
  const html = linkPage(store, 'l3');
  assert.match(text(byTestId(html, 'expired')[0]), /This link has expired/);
  assert.doesNotMatch(text(html), /Onboarding Guide/);
});

test('A5: limits on the document page', () => {
  const store = storeAt();
  patch(store, { expiresAt: '2026-10-05T00:00:00.000Z', maxOpens: 5 });
  const row = byTestId(documentPage(store, 'u_owner', 'd3'), 'link-row').find(r => r.includes('data-id="l3"'));
  assert.match(text(row), /Expires Oct 5/);
  assert.match(text(row), /1 of 5 opens/);
});
