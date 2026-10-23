import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, byTestId, changedSinceBase, createApp, createDatabase, migrate, request, rowsById, seed, text } from './helpers.mjs';

const share = (app, body, doc = 'd2', user = 'u_owner') => api(app, user, 'POST', `/api/documents/${doc}/links`, body);
const open = (app, path, query = {}) => request(app, { path, query, headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1' } });

test('A1: a new migration backfills recipients for existing links', async () => {
  assert.deepEqual(await changedSinceBase('src/db/migrations/001_init.mjs', 'src/db/migrations/002_link_controls.mjs', 'src/db/migrations/003_archive.mjs'), []);
  const db = createDatabase();
  migrate(db, { to: 3 });
  seed(db);
  migrate(db);
  assert.ok(db.hasColumn('links', 'recipients'));
  for (const l of db.all('links')) {
    assert.deepEqual(l.recipients, [l.recipientEmail], l.id);
  }
  const app = createApp({ db });
  const links = (await api(app, 'u_owner', 'GET', '/api/documents/d1/links')).body.links;
  assert.deepEqual(links.find(l => l.id === 'l1').recipients, ['cfo@kestrel.example']);
  assert.equal(links.find(l => l.id === 'l1').recipientEmail, 'cfo@kestrel.example');
});

test('A2: links take a list of recipients; the single-recipient form still works', async () => {
  const app = createApp();
  const r = await share(app, { recipients: ['amy@kestrel.example', ' BEN@kestrel.example ', 'amy@kestrel.example'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.link.recipients, ['amy@kestrel.example', 'ben@kestrel.example']);
  assert.equal(r.body.link.recipientEmail, 'amy@kestrel.example');
  const single = await share(app, { recipientEmail: 'cat@kestrel.example' });
  assert.equal(single.status, 201);
  assert.deepEqual(single.body.link.recipients, ['cat@kestrel.example']);
  assert.equal((await share(app, { recipients: ['ok@x.example', 'nope'] })).body.error, 'invalid_email');
  assert.equal((await share(app, { recipients: [] })).body.error, 'invalid_email');
  assert.equal((await share(app, { recipients: Array.from({ length: 21 }, (_, i) => `p${i}@x.example`) })).body.error, 'too_many_recipients');
  assert.equal((await share(app, { recipients: ['a@x.example'] }, 'd6')).status, 404);
  const listed = (await api(app, 'u_owner', 'GET', '/api/documents/d2/links')).body.links.find(l => l.id === r.body.link.id);
  assert.deepEqual(listed.recipients, ['amy@kestrel.example', 'ben@kestrel.example']);
});

test('A3: each recipient gets their own email with their own address', async () => {
  const app = createApp();
  const link = (await share(app, { recipients: ['amy@kestrel.example', 'ben@kestrel.example'] })).body.link;
  const sent = app.repos.outbox.all().filter(o => o.type === 'link.shared' && o.body.includes(`/l/${link.id}`));
  assert.deepEqual(sent.map(o => o.to).sort(), ['amy@kestrel.example', 'ben@kestrel.example']);
  for (const o of sent) {
    assert.ok(o.body.includes(`/l/${link.id}?to=${encodeURIComponent(o.to)}`), o.body);
  }
  assert.equal(new Set(sent.map(o => o.key)).size, 2);
});

test('A4: opens are recorded against the recipient who opened, and only the others are reminded', async () => {
  const app = createApp();
  const link = (await share(app, { recipients: ['amy@kestrel.example', 'ben@kestrel.example'] })).body.link;
  await open(app, `/l/${link.id}`, { to: 'ben@kestrel.example' });
  await open(app, `/l/${link.id}`, { to: 'mallory@evil.example' });
  const visits = (await api(app, 'u_owner', 'GET', '/api/documents/d2/analytics')).body.activity.find(a => a.linkId === link.id).visits;
  assert.deepEqual(visits.map(v => v.viewerEmail), ['ben@kestrel.example', 'amy@kestrel.example']);
  const app2 = createApp();
  const l2 = (await share(app2, { recipients: ['amy@kestrel.example', 'ben@kestrel.example'] })).body.link;
  await open(app2, `/l/${l2.id}`, { to: 'ben@kestrel.example' });
  app2.clock.set('2026-10-04T13:00:00.000Z');
  const reminded = app2.runJob('reminders').filter(m => m.body.includes(`/l/${l2.id}`)).map(m => m.to);
  assert.deepEqual(reminded, ['amy@kestrel.example']);
  app2.clock.set('2026-10-04T14:00:00.000Z');
  assert.deepEqual(app2.runJob('reminders').filter(m => m.body.includes(`/l/${l2.id}`)), []);
});

test('A5: existing single-recipient links behave as before; pages list every recipient', async () => {
  const app = createApp();
  app.clock.set('2026-10-03T13:00:00.000Z');
  assert.deepEqual(app.runJob('reminders').map(m => m.to).sort(), ['board@kestrel.example', 'legal@contoso.example']);
  await open(app, '/l/l2');
  assert.equal(app.repos.views.forLink('l2').at(-1).viewerEmail, 'board@kestrel.example');
  const link = (await share(app, { recipients: ['amy@kestrel.example', 'ben@kestrel.example'] })).body.link;
  const doc = (await api(app, 'u_owner', 'GET', '/documents/d2')).body;
  assert.equal(text(byTestId(rowsById(doc, 'link-row')[link.id], 'recipient')[0]), 'amy@kestrel.example, ben@kestrel.example');
  const activity = (await api(app, 'u_owner', 'GET', '/documents/d2/analytics')).body;
  assert.equal(text(byTestId(rowsById(activity, 'activity-row')[link.id], 'recipient')[0]), 'amy@kestrel.example, ben@kestrel.example');
});
