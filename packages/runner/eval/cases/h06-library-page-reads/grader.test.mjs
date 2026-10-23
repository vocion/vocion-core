import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTestId, createApp, request, rowsById, text, timeIt } from './helpers.mjs';

/** The seed plus `docs` documents in the team library with `perDoc` opens each, some by repeat viewers. */
function bigApp(docs, perDoc = 10) {
  const app = createApp();
  for (let i = 0; i < docs; i++) {
    const id = `bulk${i}`;
    app.db.insert('documents', { id, libraryId: 'lib_team', ownerId: 'u_owner', title: `Bulk ${i}`, mimeType: 'application/pdf', sizeBytes: 1000, pageCount: 1, uploadedAt: new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString() });
    app.db.insert('links', { id: `bl${i}`, docId: id, recipientEmail: `r${i}@x.example`, createdBy: 'u_owner', createdAt: '2026-09-01T00:00:00.000Z' });
    const n = i % 3 === 0 ? 0 : perDoc;
    for (let v = 0; v < n; v++) {
      app.db.insert('views', { id: `bv${i}_${v}`, linkId: `bl${i}`, docId: id, viewerEmail: `p${v % 3}@x.example`, userId: null, at: new Date(Date.UTC(2026, 8, 2) + v * 3600000).toISOString(), userAgent: 'Mozilla/5.0' });
    }
  }
  return app;
}

async function readsFor(app, query = {}) {
  const before = app.db.stats.reads;
  const r = await request(app, { path: '/', user: 'u_owner', query });
  assert.equal(r.status, 200);
  return { reads: app.db.stats.reads - before, html: r.body };
}

test('A1: the library page reads the database a fixed number of times, however many documents', async () => {
  const small = await readsFor(bigApp(20));
  const large = await readsFor(bigApp(400));
  assert.ok(large.reads <= 12, `400 documents took ${large.reads} reads`);
  assert.equal(large.reads, small.reads, `20 documents: ${small.reads} reads, 400: ${large.reads}`);
  const searched = await readsFor(bigApp(400), { q: 'bulk' });
  assert.ok(searched.reads <= 12 + 50, `a search page took ${searched.reads} reads`);
});

test('A2: what the page shows is unchanged', async () => {
  const { html } = await readsFor(bigApp(30));
  const rows = rowsById(html);
  assert.equal(Object.keys(rows).length, 35);
  assert.equal(text(byTestId(rows.d1, 'activity')[0]), 'Opened 2 times');
  assert.equal(text(byTestId(rows.d1, 'opened-by')[0]), 'Opened by 1');
  assert.equal(text(byTestId(rows.d2, 'activity')[0]), 'Not opened yet');
  assert.equal(text(byTestId(rows.bulk1, 'activity')[0]), 'Opened 10 times');
  assert.equal(text(byTestId(rows.bulk1, 'opened-by')[0]), 'Opened by 3');
  assert.equal(text(byTestId(rows.bulk3, 'activity')[0]), 'Not opened yet');
  const app = bigApp(5);
  const stats = app.services.analytics.documentStats(app.repos.documents.inLibrary('lib_team'));
  assert.deepEqual(stats.d1, { opens: 2, lastOpenedAt: '2026-10-01T08:15:00.000Z', openedBy: 1 });
  assert.deepEqual(stats.d2, { opens: 0, lastOpenedAt: null, openedBy: 0 });
  assert.deepEqual(stats.bulk2, { opens: 10, lastOpenedAt: '2026-09-02T09:00:00.000Z', openedBy: 3 });
});

test('A3: page time grows about linearly with the library (2000 documents, 13000 opens)', async () => {
  const small = bigApp(200);
  const large = bigApp(2000);
  await request(small, { path: '/', user: 'u_owner' });
  await request(large, { path: '/', user: 'u_owner' });
  const ts = timeIt(() => small.services.analytics.documentStats(small.repos.documents.inLibrary('lib_team')), 5);
  const tl = timeIt(() => large.services.analytics.documentStats(large.repos.documents.inLibrary('lib_team')), 3);
  assert.ok(tl < Math.max(ts, 0.5) * 30, `200 documents ${ts.toFixed(1)} ms, 2000 documents ${tl.toFixed(1)} ms`);
});

test('A4: the weekly digest counts the same opens', async () => {
  const app = bigApp(4);
  const sent = app.services.digest.run({ force: true });
  const body = sent.find(m => m.to === 'olivia@northwind.example').body;
  assert.match(body, /- Q3 Board Deck: 2 opens/);
  assert.match(body, /- Bulk 1: 10 opens/);
  assert.match(body, /- Bulk 0: 0 opens/);
});
