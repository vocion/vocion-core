import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTestId, createApp, libraryRows, request, rowsById, text } from './helpers.mjs';

const open = (app, link, user = null, headers = {}) => request(app, { path: `/l/${link}`, user, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605.1', ...headers } });
const opensOf = async (app, link, doc = 'd1') => text(byTestId(rowsById((await request(app, { path: `/documents/${doc}/analytics`, user: 'u_owner' })).body, 'activity-row')[link], 'opens')[0]);

test('A1: a library member opening a link is not counted as the recipient opening it', async () => {
  const app = createApp();
  const before = text(byTestId((await libraryRows(app)).d1, 'activity')[0]);
  await open(app, 'l2', 'u_owner');
  await open(app, 'l2', 'u_teammate');
  assert.equal(text(byTestId((await libraryRows(app)).d1, 'activity')[0]), before);
  assert.equal(await opensOf(app, 'l2'), '0 opens');
  const api = (await request(app, { path: '/api/documents/d1/analytics', user: 'u_owner' })).body.activity.find(a => a.linkId === 'l2');
  assert.equal(api.opens, 0);
  assert.ok(!api.visits.some(v => v.viewerEmail === 'board@kestrel.example'));
});

test('A2: after a member preview the recipient is still reminded', async () => {
  const app = createApp();
  await open(app, 'l2', 'u_owner');
  app.clock.set('2026-10-03T13:00:00.000Z');
  const sent = app.runJob('reminders');
  assert.ok(sent.some(m => m.to === 'board@kestrel.example'), 'board@kestrel.example should get a reminder');
});

test('A3: a real visitor still counts and still stops reminders', async () => {
  const app = createApp();
  const r = await open(app, 'l2');
  assert.equal(r.status, 200);
  assert.equal(await opensOf(app, 'l2'), '1 open');
  app.clock.set('2026-10-03T13:00:00.000Z');
  assert.ok(!app.runJob('reminders').some(m => m.to === 'board@kestrel.example'));
});

test('A4: members can still open the link and see the document', async () => {
  const app = createApp();
  const r = await open(app, 'l2', 'u_owner');
  assert.equal(r.status, 200);
  assert.equal(text(byTestId(r.body, 'title')[0]), 'Q3 Board Deck');
  const other = await open(app, 'l5', 'u_other');
  assert.equal(other.status, 200);
  assert.equal((await request(app, { path: '/api/documents/d6/analytics', user: 'u_other' })).body.activity[0].opens, 1);
});
