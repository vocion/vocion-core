import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, request, sourceFiles } from './helpers.mjs';

const get = (app, user = 'u_owner', doc = 'd1') => request(app, { path: `/api/documents/${doc}/activity.csv`, user });
const visit = (app, link, ua) => request(app, { path: `/l/${link}`, headers: { 'user-agent': ua } });

test('A1: a CSV download for the same people as the audit export', async () => {
  const app = createApp();
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(r.headers['content-disposition'], 'attachment; filename="activity-d1.csv"');
  assert.equal((await get(app, 'u_teammate')).status, 403);
  assert.equal((await get(app, 'u_other')).status, 404);
  assert.equal((await get(app, 'u_owner', 'd404')).status, 404);
  assert.equal((await get(app, null)).status, 401);
});

test('A2: one row per open, oldest first, in the exports\' format', async () => {
  const app = createApp();
  app.clock.set('2026-10-01T23:59:00.000Z');
  await visit(app, 'l2', 'Mozilla/5.0 (X11; Linux) Firefox/131.0');
  const body = (await get(app)).body;
  assert.equal(body, [
    'When (UTC),Recipient,Browser',
    '2026-09-30 10:00,cfo@kestrel.example,Mozilla/5.0 (Macintosh) Safari/605.1',
    '2026-10-01 08:15,cfo@kestrel.example,Mozilla/5.0 (Macintosh) Safari/605.1',
    '2026-10-01 23:59,board@kestrel.example,Mozilla/5.0 (X11; Linux) Firefox/131.0',
    '',
  ].join('\r\n'));
  const saved = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try {
    assert.equal((await get(app)).body, body);
  } finally {
    process.env.TZ = saved;
  }
});

test('A3: quoting, formula neutralising and robots, like the activity page', async () => {
  const app = createApp();
  await visit(app, 'l2', 'Odd, "quoted" agent');
  await visit(app, 'l2', '=HYPERLINK("http://evil.example")');
  await visit(app, 'l2', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)');
  const lines = (await get(app)).body.split('\r\n');
  assert.ok(lines.some(l => l.endsWith(',board@kestrel.example,"Odd, ""quoted"" agent"')), lines.join('\n'));
  assert.ok(lines.some(l => l.endsWith(',board@kestrel.example,"\'=HYPERLINK(""http://evil.example"")"')), lines.join('\n'));
  assert.ok(!lines.some(l => /Slackbot/.test(l)));
  assert.equal(lines.length, 6);
});

test('A4: it is built on the shared CSV helper, not a second CSV writer', async () => {
  const files = await sourceFiles('src');
  const route = files.filter(f => f.text.includes('activity.csv') || f.text.includes('activity-'));
  assert.ok(route.length, 'no source mentions the activity export');
  assert.ok(route.some(f => /from\s+['"][./]*lib\/csv\.mjs['"]/.test(f.text)) || files.some(f => /csvResponse\(\s*`activity-/.test(f.text)));
  assert.ok(!files.some(f => !f.file.endsWith('lib/csv.mjs') && /\.join\(['"]\\r\\n['"]\)/.test(f.text)), 'CSV lines joined outside lib/csv.mjs');
});
