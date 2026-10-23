import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, byTestId, changedSinceBase, createApp, createDatabase, libraryRows, migrate, MIGRATIONS, request, seed, text } from './helpers.mjs';

const NOW = '2026-10-01T12:00:00.000Z';
const setExpiry = (app, id, expiresAt, user = 'u_owner') => api(app, user, 'PATCH', `/api/documents/${id}`, { expiresAt });

test('A1: a new migration adds expiresAt; shipped migrations untouched; existing rows upgrade to null', async () => {
  assert.deepEqual(await changedSinceBase('src/db/migrations/001_init.mjs', 'src/db/migrations/002_link_controls.mjs', 'src/db/migrations/003_archive.mjs'), []);
  assert.ok(MIGRATIONS.length >= 4);
  const db = createDatabase();
  migrate(db, { to: 3 });
  seed(db);
  assert.equal(db.hasColumn('documents', 'expiresAt'), false);
  migrate(db);
  assert.equal(db.hasColumn('documents', 'expiresAt'), true);
  assert.ok(db.all('documents').every(d => d.expiresAt === null));
  const app = createApp({ db, now: NOW });
  assert.equal((await libraryRows(app)).d1 !== undefined, true);
});

test('A2: PATCH sets and clears expiresAt; validation and permissions', async () => {
  const app = createApp({ now: NOW });
  let r = await setExpiry(app, 'd1', '2026-10-10T00:00:00.000Z');
  assert.equal(r.status, 200);
  assert.equal(r.body.document.expiresAt, '2026-10-10T00:00:00.000Z');
  assert.equal(r.body.document.title, 'Q3 Board Deck');
  assert.equal(app.repos.documents.find('d1').title, 'Q3 Board Deck');
  r = await setExpiry(app, 'd1', null);
  assert.equal(r.status, 200);
  assert.equal(app.repos.documents.find('d1').expiresAt, null);
  for (const bad of ['next week', '2026-09-01T00:00:00.000Z', 42]) {
    r = await setExpiry(app, 'd1', bad);
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.error, 'invalid_expiry');
  }
  // the uploader of d1 is the owner; a teammate (editor, not the uploader) may not set it
  r = await setExpiry(app, 'd1', '2026-10-10T00:00:00.000Z', 'u_teammate');
  assert.equal(r.status, 403);
  // but the teammate may still rename
  r = await api(app, 'u_teammate', 'PATCH', '/api/documents/d1', { title: 'Q3 Deck' });
  assert.equal(r.status, 200);
  r = await setExpiry(app, 'd1', '2026-10-10T00:00:00.000Z', 'u_other');
  assert.equal(r.status, 404);
  const teamDoc = (await api(app, 'u_teammate', 'POST', '/api/documents', { libraryId: 'lib_team', title: 'Tom notes' })).body.document;
  assert.equal((await setExpiry(app, teamDoc.id, '2026-10-10T00:00:00.000Z', 'u_teammate')).status, 200);
  assert.equal((await setExpiry(app, teamDoc.id, null, 'u_owner')).status, 200, 'a library owner may change any document');
  assert.ok(app.repos.audit.all().some(a => a.action === 'document.expiry_set' && a.targetId === 'd1'));
});

test('A3: an expired document leaves the library, the list API and search; members still read it', async () => {
  const app = createApp({ now: NOW });
  await setExpiry(app, 'd2', '2026-10-01T13:00:00.000Z');
  app.clock.set('2026-10-01T13:00:00.000Z');
  const rows = await libraryRows(app);
  assert.equal(rows.d2, undefined);
  assert.ok(rows.d1);
  const list = (await api(app, 'u_owner', 'GET', '/api/documents')).body.documents.map(d => d.id);
  assert.ok(!list.includes('d2'));
  const found = (await request(app, { path: '/api/documents', user: 'u_owner', query: { q: 'pricing' } })).body.documents.map(d => d.id);
  assert.ok(!found.includes('d2'));
  const one = await api(app, 'u_owner', 'GET', '/api/documents/d2');
  assert.equal(one.status, 200);
  assert.equal(one.body.document.expired, true);
  assert.equal((await api(app, 'u_owner', 'GET', '/api/documents/d1')).body.document.expired, false);
});

test('A4: links of an expired document answer 410 expired and record nothing', async () => {
  const app = createApp({ now: NOW });
  await setExpiry(app, 'd1', '2026-10-02T00:00:00.000Z');
  assert.equal((await request(app, { path: '/l/l2' })).status, 200);
  app.clock.set('2026-10-02T00:00:00.000Z');
  const before = app.repos.views.forDocument('d1').length;
  const r = await request(app, { path: '/l/l2' });
  assert.equal(r.status, 410);
  assert.doesNotMatch(String(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), /Q3 Board Deck/);
  const dl = await request(app, { path: '/l/l2/download' });
  assert.equal(dl.status, 410);
  assert.equal(app.repos.views.forDocument('d1').length, before);
});

test('A5: the expiry job removes links 30 days after expiry, audits once, keeps the document', async () => {
  const app = createApp({ now: NOW });
  await setExpiry(app, 'd1', '2026-10-02T00:00:00.000Z');
  app.clock.set('2026-10-31T00:00:00.000Z');
  app.runJob('expiry');
  assert.equal(app.repos.links.forDocument('d1').length, 2, 'not yet 30 days');
  app.clock.set('2026-11-01T00:00:00.000Z');
  app.runJob('expiry');
  app.runJob('expiry');
  assert.equal(app.repos.links.forDocument('d1').length, 0);
  assert.ok(app.repos.documents.find('d1'));
  assert.equal(app.repos.audit.all().filter(a => a.action === 'document.expired' && a.targetId === 'd1').length, 1);
  assert.equal(app.repos.links.forDocument('d3').length, 1);
});

test('A6: the library marks documents expiring within 7 days', async () => {
  const app = createApp({ now: NOW });
  await setExpiry(app, 'd1', '2026-10-05T09:00:00.000Z');
  await setExpiry(app, 'd3', '2026-10-20T09:00:00.000Z');
  const rows = await libraryRows(app);
  assert.equal(text(byTestId(rows.d1, 'mark-expires')[0]), 'Expires Oct 5');
  assert.equal(byTestId(rows.d3, 'mark-expires').length, 0);
  assert.equal(byTestId(rows.d2, 'mark-expires').length, 0);
});
