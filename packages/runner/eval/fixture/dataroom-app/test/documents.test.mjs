import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, request } from './helpers.mjs';

test('members list their library; others get nothing of it', async () => {
  const app = createApp();
  const mine = await request(app, { path: '/api/documents', user: 'u_owner' });
  assert.deepEqual(mine.body.documents.map(d => d.id).sort(), ['d1', 'd2', 'd3', 'd4', 'd5']);
  const other = await request(app, { path: '/api/documents', user: 'u_other' });
  assert.deepEqual(other.body.documents.map(d => d.id), ['d6']);
  assert.equal((await request(app, { path: '/api/documents/d1', user: 'u_other' })).status, 404);
  assert.equal((await request(app, { path: '/api/documents' })).status, 401);
});

test('rename by any member; archive only by the uploader; delete by uploader or library owner', async () => {
  const app = createApp();
  assert.equal((await request(app, { method: 'PATCH', path: '/api/documents/d2', user: 'u_teammate', body: { title: 'Prices 2027' } })).body.document.title, 'Prices 2027');
  assert.equal((await request(app, { method: 'PATCH', path: '/api/documents/d2', user: 'u_owner', body: { title: '  ' } })).status, 400);
  assert.equal((await request(app, { method: 'POST', path: '/api/documents/d2/archive', user: 'u_teammate' })).status, 403);
  assert.ok((await request(app, { method: 'POST', path: '/api/documents/d2/archive', user: 'u_owner' })).body.document.archivedAt);
  assert.equal((await request(app, { method: 'DELETE', path: '/api/documents/d1', user: 'u_owner' })).status, 400);
  assert.equal((await request(app, { method: 'DELETE', path: '/api/documents/d5', user: 'u_teammate' })).status, 403);
  assert.equal((await request(app, { method: 'DELETE', path: '/api/documents/d5', user: 'u_owner' })).status, 204);
});

test('upload adds a document and audits it', async () => {
  const app = createApp();
  const r = await request(app, { method: 'POST', path: '/api/documents', user: 'u_teammate', body: { libraryId: 'lib_team', title: 'Term Sheet', pageCount: 3 } });
  assert.equal(r.status, 201);
  assert.equal(app.repos.audit.forTarget(r.body.document.id)[0].action, 'document.created');
  assert.equal((await request(app, { method: 'POST', path: '/api/documents', user: 'u_other', body: { libraryId: 'lib_team', title: 'x' } })).status, 404);
});
