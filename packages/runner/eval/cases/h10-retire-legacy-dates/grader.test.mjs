import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, request, sourceFiles } from './helpers.mjs';

// Every date the product shows or keys, as it was before the change with the server on UTC.
const EXPECTED = { library: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northwind Deals</title><link rel="stylesheet" href="/app.css"></head><body><main><h1 data-testid="library-name">Northwind Deals</h1><form data-testid="search" action="/" method="get"><input name="q" value="" aria-label="Search"></form><p data-testid="count">5 documents</p><ul data-testid="documents"><li data-testid="doc-row" data-id="d2"><a class="title" href="/documents/d2">Pricing Sheet</a><div class="meta"><span data-testid="uploaded">Oct 1, 2026</span> · <span data-testid="pages">1 page</span> · <span data-testid="type">Excel</span></div><div class="activity"><span data-testid="activity">Not opened yet</span></div></li><li data-testid="doc-row" data-id="d1"><a class="title" href="/documents/d1">Q3 Board Deck</a><div class="meta"><span data-testid="uploaded">Sep 30, 2026</span> · <span data-testid="pages">18 pages</span> · <span data-testid="type">PDF</span></div><div class="activity"><span data-testid="activity">Opened 2 times</span> <span data-testid="opened-by">Opened by 1</span></div></li><li data-testid="doc-row" data-id="d5"><a class="title" href="/documents/d5">Product One-Pager</a><div class="meta"><span data-testid="uploaded">Sep 28, 2026</span> · <span data-testid="pages">1 page</span> · <span data-testid="type">PDF</span></div><div class="activity"><span data-testid="activity">Not opened yet</span></div></li><li data-testid="doc-row" data-id="d4"><a class="title" href="/documents/d4">Draft Contract</a><div class="meta"><span data-testid="uploaded">Sep 20, 2026</span> · <span data-testid="pages">4 pages</span> · <span data-testid="type">Word</span></div><div class="activity"><span data-testid="activity">Not opened yet</span></div></li><li data-testid="doc-row" data-id="d3"><a class="title" href="/documents/d3">Onboarding Guide</a><div class="meta"><span data-testid="uploaded">Sep 12, 2026</span> · <span data-testid="pages">12 pages</span> · <span data-testid="type">PDF</span></div><div class="activity"><span data-testid="activity">Opened 2 times</span> <span data-testid="opened-by">Opened by 1</span></div></li></ul></main></body></html>', document: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Onboarding Guide</title><link rel="stylesheet" href="/app.css"></head><body><main><a data-testid="back" href="/">Library</a><h1 data-testid="title">Onboarding Guide</h1><p data-testid="doc-meta">12 pages · PDF · 980 KB · uploaded Sep 12, 2026</p><section data-testid="links"><h2>Links</h2><ul><li data-testid="link-row" data-id="l3"><span data-testid="recipient">new.hire@northwind.example</span> <span data-testid="link-created">Sep 13</span> </li></ul></section><a data-testid="analytics-link" href="/documents/d3/analytics">Activity</a></main></body></html>', document1: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Q3 Board Deck</title><link rel="stylesheet" href="/app.css"></head><body><main><a data-testid="back" href="/">Library</a><h1 data-testid="title">Q3 Board Deck</h1><p data-testid="doc-meta">18 pages · PDF · 2.4 MB · uploaded Sep 30, 2026</p><section data-testid="links"><h2>Links</h2><ul><li data-testid="link-row" data-id="l1"><span data-testid="recipient">cfo@kestrel.example</span> <span data-testid="link-created">Sep 30</span> </li><li data-testid="link-row" data-id="l2"><span data-testid="recipient">board@kestrel.example</span> <span data-testid="link-created">Sep 30</span> </li></ul></section><a data-testid="analytics-link" href="/documents/d1/analytics">Activity</a></main></body></html>', audit: 'When (UTC),Who,Action,Target,Recipient\r\n2026-09-30 09:30,olivia@northwind.example,link.created,l1,cfo@kestrel.example\r\n2026-09-30 09:35,olivia@northwind.example,link.created,l2,board@kestrel.example\r\n2026-09-30 23:45,olivia@northwind.example,link.removed,l1,old@kestrel.example\r\n', reminders: [{ to: 'board@kestrel.example', subject: 'Reminder: Olivia Park shared "Q3 Board Deck" with you', body: 'Olivia Park shared "Q3 Board Deck" with you on Sep 30 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l2\n', key: 'reminder:l2:2026-10-03' }, { to: 'legal@contoso.example', subject: 'Reminder: Olivia Park shared "Draft Contract" with you', body: 'Olivia Park shared "Draft Contract" with you on Sep 20 and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/l4\n', key: 'reminder:l4:2026-10-03' }], digest: [{ to: 'olivia@northwind.example', subject: 'Your week in Northwind Deals', body: 'Week of Sep 28\n\n- Q3 Board Deck: 2 opens\n- Pricing Sheet: 0 opens\n- Onboarding Guide: 2 opens\n- Draft Contract: 0 opens\n- Product One-Pager: 0 opens\n', key: 'digest:lib_team:2026-10-05:u_owner' }, { to: 'ana@acme.example', subject: 'Your week in Acme Board', body: 'Week of Sep 28\n\n- Private Notes: 1 opens\n', key: 'digest:lib_other:2026-10-05:u_other' }], link: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Onboarding Guide</title><link rel="stylesheet" href="/app.css"></head><body><main><h1 data-testid="title">Onboarding Guide</h1><p data-testid="shared-by">Shared by Olivia Park on Sep 13, 2026</p><div data-testid="viewer">12 pages</div><a data-testid="download" href="/l/l3/download">Download</a></main></body></html>' };

async function snapshot() {
  const app = createApp();
  // activity across day boundaries in most zones
  app.db.insert('audit', { id: 'a9', at: '2026-09-30T23:45:00.000Z', actorId: 'u_owner', action: 'link.removed', targetId: 'l1', detail: { docId: 'd1', recipientEmail: 'old@kestrel.example' } });
  const out = {};
  out.library = (await request(app, { path: '/', user: 'u_owner' })).body;
  out.document = (await request(app, { path: '/documents/d3', user: 'u_owner' })).body;
  out.document1 = (await request(app, { path: '/documents/d1', user: 'u_owner' })).body;
  out.audit = (await request(app, { path: '/api/libraries/lib_team/audit.csv', user: 'u_owner' })).body;
  app.clock.set('2026-10-03T23:30:00.000Z');
  out.reminders = app.runJob('reminders').map(m => ({ to: m.to, subject: m.subject, body: m.body, key: m.key }));
  app.clock.set('2026-10-05T23:00:00.000Z');
  out.digest = app.services.digest.run().map(m => ({ to: m.to, subject: m.subject, body: m.body, key: m.key }));
  out.link = (await request(app, { path: '/l/l3' })).body;
  return out;
}

async function inZone(tz) {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await snapshot();
  } finally {
    process.env.TZ = saved;
  }
}

function same(got, label) {
  for (const k of Object.keys(EXPECTED)) {
    assert.deepEqual(got[k], EXPECTED[k], `${label}: ${k} changed`);
  }
}

test('A1: legacyDate is gone and nothing imports it', async () => {
  const files = await sourceFiles('src');
  assert.ok(!files.some(f => f.file.endsWith('lib/legacyDate.mjs')), 'src/lib/legacyDate.mjs still exists');
  const imports = f => /(?:from|import\()\s*['"][^'"]*legacyDate/.test(f.text);
  assert.deepEqual([...files, ...await sourceFiles('test')].filter(imports).map(f => f.file), []);
});

test('A2: every page, export and email reads exactly as before on a UTC server', async () => {
  same(await inZone('UTC'), 'UTC');
});

test('A3: and exactly the same on servers in other time zones', async () => {
  for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata']) {
    same(await inZone(tz), tz);
  }
});
