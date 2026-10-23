import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, storeAt } from './helpers.mjs';

const remind = (store, id = 'd4', userId = 'u_owner') => api(store, { method: 'POST', path: `/api/documents/${id}/reminders`, userId });

test('A1: queued for unopened links', () => {
  const r = remind(storeAt());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.queued, ['legal@contoso.example']);
});

test('A2: opened links get none', () => {
  const store = storeAt();
  assert.deepEqual(remind(store, 'd1').body.queued, []);
  assert.equal((store.db.outbox || []).length, 0);
});

test('A3: 72 hours', () => {
  const store = storeAt();
  remind(store);
  store.db.now = '2026-10-04T11:59:00.000Z';
  const again = remind(store);
  assert.deepEqual(again.body.queued, []);
  assert.deepEqual(again.body.skipped, ['legal@contoso.example']);
  store.db.now = '2026-10-04T12:00:00.000Z';
  assert.deepEqual(remind(store).body.queued, ['legal@contoso.example']);
  assert.equal(store.db.outbox.length, 2);
});

test('A4: the outbox row', () => {
  const store = storeAt();
  remind(store);
  assert.deepEqual(store.db.outbox[0], { to: 'legal@contoso.example', linkId: 'l4', docId: 'd4', at: '2026-10-01T12:00:00.000Z' });
});

test('A5: non-members', () => {
  assert.equal(remind(storeAt(), 'd4', 'u_other').status, 404);
});
