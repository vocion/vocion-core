import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, changedSinceBase, createApp, createDatabase, migrate, request, seed } from './helpers.mjs';

const mint = (app, body = { name: 'CRM sync', scope: 'read' }, user = 'u_owner') => api(app, user, 'POST', '/api/tokens', body);
const bearer = (app, secret, method, path, body = {}) => request(app, { method, path, body, headers: { authorization: `Bearer ${secret}` } });

test('A1: tokens live in a new table, and only a hash of the secret is stored', async () => {
  assert.deepEqual(await changedSinceBase('src/db/migrations/001_init.mjs', 'src/db/migrations/002_link_controls.mjs', 'src/db/migrations/003_archive.mjs'), []);
  const db = createDatabase();
  migrate(db, { to: 3 });
  seed(db);
  migrate(db);
  const app = createApp({ db });
  const r = await mint(app);
  assert.equal(r.status, 201);
  const { secret, token } = r.body;
  assert.equal(typeof secret, 'string');
  assert.ok(secret.length >= 24);
  assert.deepEqual(Object.keys(token).filter(k => /secret|hash/i.test(k)), []);
  assert.equal(token.scope, 'read');
  const tables = ['users', 'libraries', 'memberships', 'documents', 'links', 'views', 'audit', 'outbox'];
  const extra = MIGRATION_TABLES(db).filter(t => !tables.includes(t));
  assert.ok(extra.length >= 1, 'no new table');
  for (const t of [...tables, ...extra]) {
    assert.ok(!JSON.stringify(db.all(t)).includes(secret), `the secret is stored in ${t}`);
  }
});

function MIGRATION_TABLES(db) {
  const names = ['tokens', 'api_tokens', 'apiTokens', 'access_tokens', 'accessTokens', 'personal_tokens', 'personalTokens', 'token'];
  return names.filter(n => db.hasTable(n));
}

test('A2: a bearer token acts as its owner; read scope can only read', async () => {
  const app = createApp();
  const read = (await mint(app)).body.secret;
  const write = (await mint(app, { name: 'Zapier', scope: 'write' })).body.secret;
  const me = await bearer(app, read, 'GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, 'u_owner');
  assert.equal((await bearer(app, read, 'GET', '/api/documents/d1')).status, 200);
  const writes = app.db.stats.writes;
  const refused = await bearer(app, read, 'POST', '/api/documents/d1/links', { recipientEmail: 'x@y.example' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'insufficient_scope');
  assert.equal((await bearer(app, read, 'PATCH', '/api/documents/d1', { title: 'x' })).status, 403);
  assert.ok(app.repos.links.forDocument('d1').length === 2);
  assert.ok(app.db.stats.writes - writes <= 2, 'a refused call wrote more than a last-used time');
  assert.equal((await bearer(app, write, 'POST', '/api/documents/d1/links', { recipientEmail: 'x@y.example' })).status, 201);
  assert.equal((await bearer(app, 'dr_not_a_real_token_000000000', 'GET', '/api/me')).status, 401);
  assert.equal((await bearer(app, read, 'GET', '/api/documents/d6')).status, 404, 'a token sees what its owner sees');
});

test('A3: owners list and revoke their tokens; revoked tokens stop working', async () => {
  const app = createApp();
  const { token, secret } = (await mint(app)).body;
  await mint(app, { name: 'Tom', scope: 'write' }, 'u_teammate');
  const list = (await api(app, 'u_owner', 'GET', '/api/tokens')).body.tokens;
  assert.deepEqual(list.map(t => t.id), [token.id]);
  assert.ok(!JSON.stringify(list).includes(secret));
  assert.deepEqual(list.flatMap(Object.keys).filter(k => /secret|hash/i.test(k)), []);
  assert.equal((await api(app, 'u_teammate', 'DELETE', `/api/tokens/${token.id}`)).status, 404);
  assert.equal((await api(app, 'u_owner', 'DELETE', `/api/tokens/${token.id}`)).status, 204);
  assert.equal((await bearer(app, secret, 'GET', '/api/me')).status, 401);
  const after = (await api(app, 'u_owner', 'GET', '/api/tokens')).body.tokens.find(t => t.id === token.id);
  assert.ok(!after || after.revokedAt);
  const audit = app.repos.audit.all().filter(a => /^token\./.test(a.action));
  assert.deepEqual(audit.map(a => a.action).sort(), ['token.created', 'token.created', 'token.revoked']);
  assert.ok(!JSON.stringify(audit).includes(secret));
});

test('A4: a token cannot manage tokens or open pages; validation', async () => {
  const app = createApp();
  const { secret, token } = (await mint(app, { name: 'all', scope: 'write' })).body;
  assert.equal((await bearer(app, secret, 'POST', '/api/tokens', { name: 'escalate', scope: 'write' })).status, 403);
  assert.equal((await bearer(app, secret, 'DELETE', `/api/tokens/${token.id}`)).status, 403);
  assert.equal((await bearer(app, secret, 'GET', '/api/tokens')).status, 403);
  assert.equal((await bearer(app, secret, 'GET', '/')).status, 401);
  assert.equal((await bearer(app, secret, 'GET', '/documents/d1')).status, 401);
  assert.equal((await mint(app, { name: 'x', scope: 'admin' })).body.error, 'invalid_scope');
  assert.equal((await mint(app, { name: '', scope: 'read' })).body.error, 'invalid_name');
  assert.equal((await request(app, { method: 'POST', path: '/api/tokens', body: { name: 'anon', scope: 'read' } })).status, 401);
});

test('A5: each use records when the token was last used', async () => {
  const app = createApp();
  const { secret, token } = (await mint(app)).body;
  assert.equal((await api(app, 'u_owner', 'GET', '/api/tokens')).body.tokens[0].lastUsedAt ?? null, null);
  app.clock.set('2026-10-02T08:30:00.000Z');
  await bearer(app, secret, 'GET', '/api/me');
  const t = (await api(app, 'u_owner', 'GET', '/api/tokens')).body.tokens.find(x => x.id === token.id);
  assert.equal(t.lastUsedAt, '2026-10-02T08:30:00.000Z');
});
