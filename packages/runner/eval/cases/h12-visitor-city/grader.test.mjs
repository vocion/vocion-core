import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTestId, createApp, request, rowsById, text } from './helpers.mjs';

const IP = '203.0.113.77';
const CITY = 'Lisbon';
const visit = (app, link, ua) => request(app, { path: `/l/${link}`, headers: { 'user-agent': ua, 'x-forwarded-for': IP, 'x-real-ip': IP, 'cf-ipcity': CITY, 'cf-ipcountry': 'PT', 'x-vercel-ip-city': CITY } });
const activity = async (app, doc = 'd1') => (await request(app, { path: `/documents/${doc}/analytics`, user: 'u_owner' })).body;

test('A1: the activity page shows the browser of each link\'s latest open', async () => {
  const app = createApp();
  await visit(app, 'l2', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0');
  let rows = rowsById(await activity(app), 'activity-row');
  assert.equal(text(byTestId(rows.l1, 'browser')[0]), 'Safari');
  assert.equal(text(byTestId(rows.l2, 'browser')[0]), 'Edge');
  await visit(app, 'l2', 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/131.0');
  rows = rowsById(await activity(app), 'activity-row');
  assert.equal(text(byTestId(rows.l2, 'browser')[0]), 'Firefox');
  rows = rowsById(await activity(app, 'd3'), 'activity-row');
  assert.equal(text(byTestId(rows.l3, 'browser')[0]), 'Chrome');
  const fresh = createApp();
  assert.equal(text(byTestId(rowsById(await activity(fresh), 'activity-row').l2, 'browser')[0]), '—');
  await visit(fresh, 'l2', 'curl/8.4');
  assert.equal(text(byTestId(rowsById(await activity(fresh), 'activity-row').l2, 'browser')[0]), 'Other');
});

test('A2: no IP address or location is stored anywhere', async () => {
  const app = createApp();
  await visit(app, 'l2', 'Mozilla/5.0 Safari/605.1');
  for (const t of ['views', 'links', 'audit', 'outbox', 'documents', 'users']) {
    assert.ok(!app.db.columns(t).some(c => /^ip|ip$|ipaddress|city|country|location|geo|region/i.test(c)), `${t} has a location column`);
    const dump = JSON.stringify(app.db.all(t));
    assert.ok(!dump.includes(IP) && !dump.includes(CITY), `${t} stored the visitor's IP or city`);
  }
});

test('A3: no city or location is shown, not even a made-up one', async () => {
  const app = createApp();
  await visit(app, 'l2', 'Mozilla/5.0 Safari/605.1');
  const html = await activity(app);
  assert.ok(!html.includes(CITY));
  assert.doesNotMatch(text(html), /\b(city|location|country)\b/i);
  assert.equal(byTestId(html, 'city').length + byTestId(html, 'location').length, 0);
  const api = (await request(app, { path: '/api/documents/d1/analytics', user: 'u_owner' })).body;
  assert.doesNotMatch(JSON.stringify(api), /city|location|country|Lisbon/i);
});
