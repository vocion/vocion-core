import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, createApp, request } from './helpers.mjs';

const ANA = { id: 'u_other', email: 'ana@acme.example', name: 'Ana Silva' };

/** The seed, plus Ana as an editor in the team library with a document of her own, a link and activity both ways. */
async function setup() {
  const app = createApp();
  app.db.insert('memberships', { id: 'm9', libraryId: 'lib_team', userId: ANA.id, role: 'editor' });
  const mine = (await api(app, ANA.id, 'POST', '/api/documents', { libraryId: 'lib_team', title: 'Ana Term Sheet' })).body.document;
  const myLink = (await api(app, ANA.id, 'POST', `/api/documents/${mine.id}/links`, { recipientEmail: 'cfo@kestrel.example' })).body.link;
  await request(app, { path: `/l/${myLink.id}`, headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1' } });
  await api(app, ANA.id, 'PATCH', '/api/documents/d6', { title: 'Private Notes v2' });
  await api(app, ANA.id, 'POST', '/api/documents/d6/links', { recipientEmail: 'board@kestrel.example' });
  const toAna = (await api(app, 'u_owner', 'POST', '/api/documents/d2/links', { recipientEmail: ANA.email })).body.link;
  await request(app, { path: `/l/${toAna.id}`, headers: { 'user-agent': 'Mozilla/5.0 Firefox/131.0' } });
  return { app, mine, myLink, toAna };
}

const erase = app => api(app, ANA.id, 'DELETE', '/api/me');
const mentionsAna = value => [ANA.id, ANA.email, ANA.name].some(s => JSON.stringify(value).toLowerCase().includes(s.toLowerCase()));

test('A1: DELETE /api/me removes the person, their documents, links, memberships and the views recorded against them', async () => {
  const { app, mine, myLink } = await setup();
  const r = await erase(app);
  assert.equal(r.status, 204);
  assert.equal(app.repos.users.find(ANA.id), null);
  assert.equal(app.repos.documents.find(mine.id), null);
  assert.equal(app.repos.documents.find('d6'), null);
  assert.equal(app.repos.links.find(myLink.id), null);
  assert.equal(app.repos.links.find('l5'), null);
  assert.ok(!app.db.all('memberships').some(m => m.userId === ANA.id));
  assert.ok(!app.db.all('views').some(v => mentionsAna(v) || v.docId === mine.id || v.docId === 'd6'));
  assert.equal((await api(app, ANA.id, 'GET', '/api/me')).status, 401);
});

test('A2: every audit entry is kept: same entries, actions, targets and times', async () => {
  const { app } = await setup();
  const before = app.repos.audit.all().map(a => [a.id, a.action, a.targetId, a.at]);
  await erase(app);
  const after = new Map(app.repos.audit.all().map(a => [a.id, [a.id, a.action, a.targetId, a.at]]));
  for (const entry of before) {
    assert.deepEqual(after.get(entry[0]), entry, `audit entry ${entry[0]} was deleted or changed`);
  }
});

test('A3: the audit log keeps no more about her than it needs: no id, email or name, one stable pseudonym', async () => {
  const { app } = await setup();
  const hers = app.repos.audit.all().filter(a => a.actorId === ANA.id).map(a => a.id);
  assert.ok(hers.length >= 4);
  await erase(app);
  const audit = app.repos.audit.all();
  assert.deepEqual(audit.filter(mentionsAna).map(a => a.id), []);
  const actors = new Set(audit.filter(a => hers.includes(a.id)).map(a => a.actorId));
  assert.equal(actors.size, 1, 'her entries should share one pseudonymous actor');
  const [pseudonym] = actors;
  assert.ok(pseudonym && !['u_owner', 'u_teammate'].includes(pseudonym));
});

test('A4: everyone else is untouched, and the erasure itself is audited without personal data', async () => {
  const { app, toAna } = await setup();
  const olivia = app.repos.audit.all().filter(a => a.actorId === 'u_owner').length;
  await erase(app);
  assert.ok(app.repos.users.find('u_owner'));
  assert.equal(app.repos.documents.inLibrary('lib_team').filter(d => /^d[1-5]$/.test(d.id)).length, 5);
  assert.equal(app.repos.views.forLink('l1').length, 2);
  assert.equal(app.repos.links.forDocument('d1').length, 2);
  assert.ok(app.repos.audit.all().filter(a => a.actorId === 'u_owner').length >= olivia);
  const erased = app.repos.audit.all().filter(a => /erase|delet|forget/i.test(a.action) && /user|account|person|me/i.test(a.action));
  assert.equal(erased.length, 1);
  assert.ok(!mentionsAna(erased[0]));
  assert.ok(toAna);
  assert.equal((await api(app, 'u_teammate', 'DELETE', '/api/me')).status, 204);
  assert.equal(app.repos.users.find('u_teammate'), null);
});
