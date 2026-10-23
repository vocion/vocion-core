import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTestId, createApp, request, text } from './helpers.mjs';

test('a link is created, audited and announced to the recipient', async () => {
  const app = createApp();
  const r = await request(app, { method: 'POST', path: '/api/documents/d2/links', user: 'u_owner', body: { recipientEmail: 'Buyer@Kestrel.example ' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.link.recipientEmail, 'buyer@kestrel.example');
  assert.equal(app.repos.outbox.to('buyer@kestrel.example')[0].type, 'link.shared');
  assert.equal(app.repos.audit.forTarget(r.body.link.id)[0].action, 'link.created');
  assert.equal((await request(app, { method: 'POST', path: '/api/documents/d2/links', user: 'u_owner', body: { recipientEmail: 'nope' } })).status, 400);
  assert.equal((await request(app, { method: 'POST', path: '/api/documents/d2/links', user: 'u_other', body: { recipientEmail: 'x@y.example' } })).status, 404);
});

test('opening a link records a view and shows the document', async () => {
  const app = createApp();
  const r = await request(app, { path: '/l/l2', headers: { 'user-agent': 'Mozilla/5.0 Safari' } });
  assert.equal(r.status, 200);
  assert.equal(text(byTestId(r.body, 'title')[0]), 'Q3 Board Deck');
  assert.equal(app.repos.views.forLink('l2').length, 1);
  assert.equal((await request(app, { path: '/l/nope' })).status, 404);
});

test('a passcode guards the link; downloads can be turned off', async () => {
  const app = createApp();
  await request(app, { method: 'PATCH', path: '/api/documents/d1/links/l2', user: 'u_owner', body: { passcode: 'tiger42', allowDownload: false } });
  assert.equal(byTestId((await request(app, { path: '/l/l2' })).body, 'passcode-form').length, 1);
  assert.equal((await request(app, { path: '/l/l2', query: { passcode: 'nope' } })).status, 401);
  const open = await request(app, { path: '/l/l2', query: { passcode: 'tiger42' } });
  assert.equal(byTestId(open.body, 'download').length, 0);
  assert.equal((await request(app, { path: '/l/l2/download' })).status, 403);
  assert.equal(app.repos.views.forLink('l2').length, 1);
  assert.doesNotMatch(JSON.stringify(app.repos.links.find('l2')), /tiger42/);
});
