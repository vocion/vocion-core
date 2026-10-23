import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { api, byTestId, changedSinceBase, createApp, createDatabase, migrate, seed, text } from './helpers.mjs';

const comment = (app, body, user = 'u_owner', doc = 'd1') => api(app, user, 'POST', `/api/documents/${doc}/comments`, { body });
const mentions = app => app.repos.outbox.all().filter(o => o.type === 'comment.mention');

test('A1: comments get their own table through a new migration', async () => {
  assert.deepEqual(await changedSinceBase('src/db/migrations/001_init.mjs', 'src/db/migrations/002_link_controls.mjs', 'src/db/migrations/003_archive.mjs'), []);
  const db = createDatabase();
  migrate(db, { to: 3 });
  seed(db);
  assert.equal(db.hasTable('comments'), false);
  migrate(db);
  assert.equal(db.hasTable('comments'), true);
  const app = createApp({ db });
  assert.equal((await comment(app, 'After upgrade')).status, 201);
});

test('A2: members comment and read comments, oldest first; validation and access', async () => {
  const app = createApp();
  const r = await comment(app, 'First look');
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body.comment).sort(), ['authorId', 'body', 'createdAt', 'docId', 'id']);
  assert.equal(r.body.comment.authorId, 'u_owner');
  app.clock.advanceMinutes(5);
  await comment(app, 'Second', 'u_teammate');
  const list = (await api(app, 'u_teammate', 'GET', '/api/documents/d1/comments')).body.comments;
  assert.deepEqual(list.map(c => c.body), ['First look', 'Second']);
  assert.equal((await comment(app, 'sneaky', 'u_other')).status, 404);
  assert.equal((await api(app, 'u_other', 'GET', '/api/documents/d1/comments')).status, 404);
  for (const bad of ['', '   ', 'x'.repeat(2001), 42]) {
    const b = await comment(app, bad);
    assert.equal(b.status, 400);
    assert.equal(b.body.error, 'invalid_body');
  }
  assert.equal((await comment(app, 'x'.repeat(2000))).status, 201);
});

test('A3: @mentions notify library members once, never outsiders or the author, and respect the preference', async () => {
  const app = createApp();
  await comment(app, 'Thanks @tom@northwind.example, see page 3. Also @ana@acme.example and @olivia@northwind.example. @TOM@northwind.example again.');
  const sent = mentions(app);
  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.equal(sent[0].to, 'tom@northwind.example');
  assert.match(sent[0].subject, /Q3 Board Deck/);
  assert.match(sent[0].body, /Olivia Park/);
  assert.equal((await api(app, 'u_teammate', 'PATCH', '/api/me/prefs', { mentions: false })).status, 200);
  await comment(app, 'Ping @tom@northwind.example');
  assert.equal(mentions(app).length, 1);
  await comment(app, 'Hi @olivia@northwind.example.', 'u_teammate');
  assert.equal(mentions(app).length, 2);
  assert.equal(mentions(app)[1].to, 'olivia@northwind.example');
});

test('A4: the document page shows comments, escaped', async () => {
  const app = createApp();
  await comment(app, '<script>alert(1)</script> & <b>bold</b>', 'u_teammate');
  const html = (await api(app, 'u_owner', 'GET', '/documents/d1')).body;
  const items = byTestId(html, 'comment');
  assert.equal(items.length, 1);
  assert.equal(text(byTestId(items[0], 'comment-author')[0]), 'Tom Reyes');
  assert.equal(text(byTestId(items[0], 'comment-body')[0]), '<script>alert(1)</script> & <b>bold</b>');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<b>bold'));
});

test('A5: docs/notifications.md lists the new type and its preference', () => {
  const doc = fs.readFileSync('docs/notifications.md', 'utf8');
  assert.match(doc, /\|\s*`?comment\.mention`?\s*\|[^\n]*\|\s*`?mentions`?\s*\|/);
});
