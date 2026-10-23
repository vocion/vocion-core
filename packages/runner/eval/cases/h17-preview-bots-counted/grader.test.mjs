import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTestId, createApp, libraryRows, request, text } from './helpers.mjs';

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15';
const BOTS = [
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Twitterbot/1.0',
  'Mozilla/5.0 (Windows NT 10.0; Microsoft Outlook 16.0; Microsoft Office/16.0)',
  'WhatsApp/2.23.20.0',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0)',
];
const hit = (app, method, ua, link = 'l2') => request(app, { method, path: `/l/${link}`, headers: { 'user-agent': ua } });
const activity = async app => text(byTestId((await libraryRows(app)).d1, 'activity')[0]);
const apiOpens = async app => (await request(app, { path: '/api/documents/d1/analytics', user: 'u_owner' })).body.activity.find(a => a.linkId === 'l2').opens;
const remindsBoard = (app) => {
  app.clock.set('2026-10-03T13:00:00.000Z');
  return app.runJob('reminders').some(m => m.to === 'board@kestrel.example');
};

test('A1: a chat app\'s link preview is not an open anywhere', async () => {
  const app = createApp();
  const r = await hit(app, 'GET', BOTS[0]);
  assert.equal(r.status, 200);
  assert.equal(await activity(app), 'Opened 2 times');
  assert.equal(await apiOpens(app), 0);
  assert.ok(remindsBoard(app), 'the recipient should still be reminded');
});

test('A2: a HEAD request from a mail scanner is not an open', async () => {
  const app = createApp();
  const r = await hit(app, 'HEAD', BROWSER);
  assert.equal(r.status, 200);
  assert.equal(await activity(app), 'Opened 2 times');
  assert.equal(await apiOpens(app), 0);
  assert.ok(remindsBoard(app));
});

test('A3: no known robot counts; a person in a browser does, and stops reminders', async () => {
  const app = createApp();
  for (const ua of BOTS) {
    await hit(app, 'GET', ua);
  }
  assert.equal(await activity(app), 'Opened 2 times');
  const digest = app.services.digest.run({ force: true }).find(m => m.to === 'olivia@northwind.example').body;
  assert.match(digest, /- Q3 Board Deck: 2 opens/);
  await hit(app, 'GET', BROWSER);
  assert.equal(await activity(app), 'Opened 3 times');
  assert.equal(await apiOpens(app), 1);
  assert.ok(!remindsBoard(app));
});

test('A4: robots still get the page they need to draw a preview', async () => {
  const app = createApp();
  const r = await hit(app, 'GET', BOTS[1]);
  assert.equal(r.status, 200);
  assert.equal(text(byTestId(r.body, 'title')[0]), 'Q3 Board Deck');
});
