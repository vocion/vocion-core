import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, byTestId, createApp, request } from './helpers.mjs';

const addMember = (app, email, role, by = 'u_owner', lib = 'lib_team') => api(app, by, 'POST', `/api/libraries/${lib}/members`, { email, role });
const setRole = (app, userId, role, by = 'u_owner', lib = 'lib_team') => api(app, by, 'PATCH', `/api/libraries/${lib}/members/${userId}`, { role });

async function withViewer() {
  const app = createApp();
  const r = await addMember(app, 'ana@acme.example', 'viewer');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return app;
}

test('A1: library owners add members with a role', async () => {
  const app = createApp();
  assert.equal((await addMember(app, 'ana@acme.example', 'viewer', 'u_teammate')).status, 403);
  assert.equal((await addMember(app, 'ana@acme.example', 'boss')).body.error, 'invalid_role');
  assert.equal((await addMember(app, 'nobody@acme.example', 'viewer')).body.error, 'unknown_user');
  assert.equal((await addMember(app, 'ana@acme.example', 'viewer', 'u_other')).status, 404);
  const r = await addMember(app, 'ANA@acme.example', 'viewer');
  assert.equal(r.status, 201);
  assert.equal(r.body.member.userId, 'u_other');
  assert.equal(r.body.member.role, 'viewer');
  assert.equal((await addMember(app, 'ana@acme.example', 'editor')).body.error, 'already_member');
  assert.equal(app.repos.libraries.membership('lib_team', 'u_other').role, 'viewer');
  assert.ok(app.repos.audit.all().some(a => a.action === 'member.added' && a.actorId === 'u_owner'));
});

test('A2: a viewer reads the library, its documents and search', async () => {
  const app = await withViewer();
  assert.equal((await request(app, { path: '/', user: 'u_other', query: { library: 'lib_team' } })).status, 200);
  assert.ok((await api(app, 'u_other', 'GET', '/api/documents')).body.documents.some(d => d.id === 'd1'));
  assert.equal((await api(app, 'u_other', 'GET', '/api/documents/d1')).status, 200);
  assert.equal((await api(app, 'u_other', 'GET', '/documents/d1')).status, 200);
  assert.deepEqual((await request(app, { path: '/api/documents', user: 'u_other', query: { q: 'board' } })).body.documents.map(d => d.id), ['d1']);
});

test('A3: a viewer changes nothing and sees no recipients or activity (403 everywhere)', async () => {
  const app = await withViewer();
  const writesBefore = app.db.stats.writes;
  const calls = [
    ['POST', '/api/documents', { libraryId: 'lib_team', title: 'Mine' }],
    ['PATCH', '/api/documents/d1', { title: 'Hacked' }],
    ['POST', '/api/documents/d1/archive', {}],
    ['DELETE', '/api/documents/d2', {}],
    ['GET', '/api/documents/d1/links', {}],
    ['POST', '/api/documents/d1/links', { recipientEmail: 'x@y.example' }],
    ['PATCH', '/api/documents/d1/links/l1', { allowDownload: false }],
    ['DELETE', '/api/documents/d1/links/l1', {}],
    ['GET', '/api/documents/d1/analytics', {}],
    ['GET', '/documents/d1/analytics', {}],
    ['GET', '/api/libraries/lib_team/audit.csv', {}],
    ['POST', '/api/libraries/lib_team/members', { email: 'tom@northwind.example', role: 'viewer' }],
  ];
  for (const [m, p, b] of calls) {
    const r = await api(app, 'u_other', m, p, b);
    assert.equal(r.status, 403, `${m} ${p} answered ${r.status}`);
  }
  assert.equal(app.db.stats.writes, writesBefore, 'a refused call wrote something');
  const page = (await api(app, 'u_other', 'GET', '/documents/d1')).body;
  assert.equal(byTestId(page, 'link-row').length, 0);
  assert.equal(byTestId(page, 'analytics-link').length, 0);
  assert.doesNotMatch(page, /cfo@kestrel\.example/);
  assert.equal(byTestId((await api(app, 'u_teammate', 'GET', '/documents/d1')).body, 'link-row').length, 2);
});

test('A4: owners change roles; the last owner cannot be demoted', async () => {
  const app = await withViewer();
  assert.equal((await setRole(app, 'u_other', 'editor', 'u_teammate')).status, 403);
  assert.equal((await setRole(app, 'u_other', 'god')).body.error, 'invalid_role');
  assert.equal((await setRole(app, 'u_other', 'editor')).status, 200);
  assert.equal((await api(app, 'u_other', 'PATCH', '/api/documents/d1', { title: 'Renamed by Ana' })).status, 200);
  const last = await setRole(app, 'u_owner', 'editor');
  assert.equal(last.status, 400);
  assert.equal(last.body.error, 'last_owner');
  assert.equal((await setRole(app, 'u_teammate', 'owner')).status, 200);
  assert.equal((await setRole(app, 'u_owner', 'viewer', 'u_teammate')).status, 200);
  assert.equal((await api(app, 'u_owner', 'PATCH', '/api/documents/d1', { title: 'x' })).status, 403);
  assert.ok(app.repos.audit.all().filter(a => a.action === 'member.role_changed').length >= 3);
  assert.equal((await setRole(app, 'u_nobody', 'viewer', 'u_teammate')).status, 404);
});

test('A5: editors and outsiders are unaffected', async () => {
  const app = createApp();
  assert.equal((await api(app, 'u_teammate', 'POST', '/api/documents/d1/links', { recipientEmail: 'x@y.example' })).status, 201);
  assert.equal((await api(app, 'u_teammate', 'GET', '/api/documents/d1/analytics')).status, 200);
  assert.equal((await api(app, 'u_teammate', 'PATCH', '/api/documents/d1', { title: 'T' })).status, 200);
  assert.equal((await api(app, 'u_teammate', 'POST', '/api/documents/d1/archive')).status, 403);
  for (const p of ['/api/documents/d1', '/api/documents/d1/links', '/api/documents/d1/analytics']) {
    assert.equal((await api(app, 'u_other', 'GET', p)).status, 404, p);
  }
});
