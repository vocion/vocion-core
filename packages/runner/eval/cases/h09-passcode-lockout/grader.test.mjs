import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, byTestId, createApp, request, text } from './helpers.mjs';

async function protectedApp(db) {
  const app = createApp(db ? { db } : {});
  if (!db) {
    assert.equal((await api(app, 'u_owner', 'PATCH', '/api/documents/d1/links/l2', { passcode: '4321' })).status, 200);
    assert.equal((await api(app, 'u_owner', 'PATCH', '/api/documents/d3/links/l3', { passcode: '9999' })).status, 200);
  }
  return app;
}
const tryCode = (app, passcode, link = 'l2', user = null) => request(app, { path: `/l/${link}`, query: passcode === undefined ? {} : { passcode }, user });
const views = (app, link = 'l2') => app.repos.views.forLink(link).length;

test('A1: the fifth wrong passcode within 10 minutes locks the link; even the right one is refused', async () => {
  const app = await protectedApp();
  for (let i = 0; i < 4; i++) {
    assert.equal((await tryCode(app, `000${i}`)).status, 401);
    app.clock.advanceMinutes(1);
  }
  const fifth = await tryCode(app, '0004');
  assert.equal(fifth.status, 429);
  app.clock.advanceMinutes(5);
  const right = await tryCode(app, '4321');
  assert.equal(right.status, 429);
  assert.equal(views(app), 0);
  assert.equal(byTestId(right.body, 'passcode-locked').length, 1);
  assert.equal(byTestId(right.body, 'passcode-form').length, 0);
  assert.doesNotMatch(text(right.body), /Q3 Board Deck/);
});

test('A2: it unlocks after 15 minutes; failures spread beyond 10 minutes never lock', async () => {
  const app = await protectedApp();
  for (let i = 0; i < 5; i++) {
    await tryCode(app, 'nope');
  }
  app.clock.advanceMinutes(14);
  assert.equal((await tryCode(app, '4321')).status, 429);
  app.clock.advanceMinutes(1);
  assert.equal((await tryCode(app, '4321')).status, 200);
  assert.equal(views(app), 1);
  assert.equal((await tryCode(app, 'nope')).status, 401, 'the count starts again after a lock');
  const spread = await protectedApp();
  for (const gap of [0, 1, 1, 1, 8, 1, 1, 1, 8, 1, 1, 1]) {
    spread.clock.advanceMinutes(gap);
    assert.equal((await tryCode(spread, 'bad')).status, 401);
  }
});

test('A3: the lock is per link, survives a restart and is audited once', async () => {
  const app = await protectedApp();
  for (let i = 0; i < 6; i++) {
    await tryCode(app, 'bad');
  }
  assert.equal((await tryCode(app, '9999', 'l3')).status, 200, 'another link is unaffected');
  const restarted = await protectedApp(app.db);
  restarted.clock.set(app.clock.now());
  assert.equal((await tryCode(restarted, '4321')).status, 429);
  assert.equal(app.repos.audit.all().filter(a => a.action === 'link.locked' && a.targetId === 'l2').length, 1);
});

test('A4: library members are never asked for the passcode; others still are', async () => {
  const app = await protectedApp();
  const owner = await tryCode(app, undefined, 'l2', 'u_owner');
  assert.equal(owner.status, 200);
  assert.equal(byTestId(owner.body, 'passcode-form').length, 0);
  assert.equal(text(byTestId(owner.body, 'title')[0]), 'Q3 Board Deck');
  assert.equal(byTestId((await tryCode(app, undefined, 'l2', 'u_teammate')).body, 'passcode-form').length, 0);
  assert.equal(byTestId((await tryCode(app, undefined, 'l2', 'u_other')).body, 'passcode-form').length, 1);
  assert.equal(byTestId((await tryCode(app, undefined, 'l2')).body, 'passcode-form').length, 1);
});
