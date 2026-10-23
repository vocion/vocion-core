import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './helpers.mjs';

test('reminders go to recipients who have not opened, after 3 days, once a day', () => {
  const app = createApp({ now: '2026-10-03T10:00:00.000Z' });
  const sent = app.runJob('reminders').map(m => m.to);
  assert.deepEqual(sent.sort(), ['board@kestrel.example', 'legal@contoso.example']);
  assert.deepEqual(app.runJob('reminders'), []);
  app.clock.set('2026-10-04T10:00:00.000Z');
  assert.equal(app.runJob('reminders').length, 2);
});

test('a person who turned reminders off gets none', () => {
  const app = createApp({ now: '2026-10-03T10:00:00.000Z' });
  app.repos.users.setPrefs('u_owner', { reminders: false });
  app.services.sharing.createLink('u_owner', 'd5', 'olivia@northwind.example');
  app.clock.set('2026-10-07T10:00:00.000Z');
  assert.ok(!app.runJob('reminders').some(m => m.to === 'olivia@northwind.example'));
});

test('the digest goes to library owners on Mondays', () => {
  const app = createApp({ now: '2026-10-05T07:00:00.000Z' });
  const sent = app.runJob('digest');
  assert.deepEqual(sent.map(m => m.to).sort(), ['ana@acme.example', 'olivia@northwind.example']);
  const mine = sent.find(m => m.to === 'olivia@northwind.example');
  assert.equal(mine.subject, 'Your week in Northwind Deals');
  assert.match(mine.body, /^Week of Sep 28\n/);
  assert.match(mine.body, /- Q3 Board Deck: 2 opens/);
  app.clock.set('2026-10-06T07:00:00.000Z');
  assert.deepEqual(app.runJob('digest'), []);
});
