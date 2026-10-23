import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTestId, createApp, request, rowsById, text } from './helpers.mjs';

test('the library page lists documents newest first with their activity', async () => {
  const app = createApp();
  const html = (await request(app, { path: '/', user: 'u_owner' })).body;
  assert.deepEqual(Object.keys(rowsById(html)), ['d2', 'd1', 'd5', 'd4', 'd3']);
  const rows = rowsById(html);
  assert.equal(text(byTestId(rows.d1, 'activity')[0]), 'Opened 2 times');
  assert.equal(text(byTestId(rows.d1, 'opened-by')[0]), 'Opened by 1');
  assert.equal(text(byTestId(rows.d2, 'activity')[0]), 'Not opened yet');
  assert.equal(text(byTestId(rows.d1, 'uploaded')[0]), 'Sep 30, 2026');
  assert.equal(text(byTestId(html, 'count')[0]), '5 documents');
});

test('search finds by word starts, in any order, only in your libraries', async () => {
  const app = createApp();
  const ids = async (q, user = 'u_owner') => (await request(app, { path: '/api/documents', user, query: { q } })).body.documents.map(d => d.id);
  assert.deepEqual(await ids('deck q3'), ['d1']);
  assert.deepEqual(await ids('onboard'), ['d3']);
  assert.deepEqual(await ids('board'), ['d1']);
  assert.deepEqual(await ids('notes'), []);
  assert.deepEqual(await ids('notes', 'u_other'), ['d6']);
});

test('the document page lists links with their marks; analytics shows opens', async () => {
  const app = createApp();
  await request(app, { method: 'PATCH', path: '/api/documents/d1/links/l2', user: 'u_owner', body: { allowDownload: false } });
  const html = (await request(app, { path: '/documents/d1', user: 'u_owner' })).body;
  const links = rowsById(html, 'link-row');
  assert.equal(byTestId(links.l2, 'mark-no-download').length, 1);
  assert.equal(byTestId(links.l1, 'mark-no-download').length, 0);
  const a = (await request(app, { path: '/documents/d1/analytics', user: 'u_owner' })).body;
  const rows = rowsById(a, 'activity-row');
  assert.equal(text(byTestId(rows.l1, 'opens')[0]), '2 opens');
  assert.equal(text(byTestId(rows.l1, 'last-opened')[0]), '2026-10-01 08:15');
  assert.equal((await request(app, { path: '/documents/d6', user: 'u_owner' })).status, 404);
});

test('the audit export is for library owners', async () => {
  const app = createApp();
  const r = await request(app, { path: '/api/libraries/lib_team/audit.csv', user: 'u_owner' });
  assert.equal(r.headers['content-disposition'], 'attachment; filename="audit-lib_team.csv"');
  assert.equal(r.body.split('\r\n')[1], '2026-09-30 09:30,olivia@northwind.example,link.created,l1,cfo@kestrel.example');
  assert.equal((await request(app, { path: '/api/libraries/lib_team/audit.csv', user: 'u_teammate' })).status, 403);
  assert.equal((await request(app, { path: '/api/libraries/lib_team/audit.csv', user: 'u_other' })).status, 404);
});
