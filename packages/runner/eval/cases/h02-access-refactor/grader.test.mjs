import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp, sourceFiles } from './helpers.mjs';

// Every route that names a document, for every kind of caller and document, exactly as before the
// refactor (status and error code). Generated from the fixture before the change.
const EXPECTED = { 'u_owner|d1|0': 200, 'u_owner|d1|1': 200, 'u_owner|d1|2': 200, 'u_owner|d1|3': '400:has_links', 'u_owner|d1|4': 200, 'u_owner|d1|5': 201, 'u_owner|d1|6': 200, 'u_owner|d1|7': 204, 'u_owner|d1|8': 200, 'u_owner|d1|9': 200, 'u_owner|d1|10': 200, 'u_owner|d1|11': '400:invalid_title', 'u_owner|d1|12': '400:invalid_email', 'u_owner|d1|13': '400:passcode_too_short', 'u_owner|d5|0': 200, 'u_owner|d5|1': 200, 'u_owner|d5|2': 200, 'u_owner|d5|3': 204, 'u_owner|d5|4': 200, 'u_owner|d5|5': 201, 'u_owner|d5|6': '404:not_found', 'u_owner|d5|7': '404:not_found', 'u_owner|d5|8': 200, 'u_owner|d5|9': 200, 'u_owner|d5|10': 200, 'u_owner|d5|11': '400:invalid_title', 'u_owner|d5|12': '400:invalid_email', 'u_owner|d5|13': '404:not_found', 'u_owner|tdoc|0': 200, 'u_owner|tdoc|1': 200, 'u_owner|tdoc|2': '403:forbidden', 'u_owner|tdoc|3': '400:has_links', 'u_owner|tdoc|4': 200, 'u_owner|tdoc|5': 201, 'u_owner|tdoc|6': 200, 'u_owner|tdoc|7': 204, 'u_owner|tdoc|8': 200, 'u_owner|tdoc|9': 200, 'u_owner|tdoc|10': 200, 'u_owner|tdoc|11': '400:invalid_title', 'u_owner|tdoc|12': '400:invalid_email', 'u_owner|tdoc|13': '400:passcode_too_short', 'u_owner|tdoc2|0': 200, 'u_owner|tdoc2|1': 200, 'u_owner|tdoc2|2': '403:forbidden', 'u_owner|tdoc2|3': 204, 'u_owner|tdoc2|4': 200, 'u_owner|tdoc2|5': 201, 'u_owner|tdoc2|6': '404:not_found', 'u_owner|tdoc2|7': '404:not_found', 'u_owner|tdoc2|8': 200, 'u_owner|tdoc2|9': 200, 'u_owner|tdoc2|10': 200, 'u_owner|tdoc2|11': '400:invalid_title', 'u_owner|tdoc2|12': '400:invalid_email', 'u_owner|tdoc2|13': '404:not_found', 'u_owner|d6|0': '404:not_found', 'u_owner|d6|1': '404:not_found', 'u_owner|d6|2': '404:not_found', 'u_owner|d6|3': '404:not_found', 'u_owner|d6|4': '404:not_found', 'u_owner|d6|5': '404:not_found', 'u_owner|d6|6': '404:not_found', 'u_owner|d6|7': '404:not_found', 'u_owner|d6|8': '404:not_found', 'u_owner|d6|9': '404:not_found', 'u_owner|d6|10': '404:not_found', 'u_owner|d6|11': '404:not_found', 'u_owner|d6|12': '404:not_found', 'u_owner|d6|13': '404:not_found', 'u_owner|nope|0': '404:not_found', 'u_owner|nope|1': '404:not_found', 'u_owner|nope|2': '404:not_found', 'u_owner|nope|3': '404:not_found', 'u_owner|nope|4': '404:not_found', 'u_owner|nope|5': '404:not_found', 'u_owner|nope|6': '404:not_found', 'u_owner|nope|7': '404:not_found', 'u_owner|nope|8': '404:not_found', 'u_owner|nope|9': '404:not_found', 'u_owner|nope|10': '404:not_found', 'u_owner|nope|11': '404:not_found', 'u_owner|nope|12': '404:not_found', 'u_owner|nope|13': '404:not_found', 'u_teammate|d1|0': 200, 'u_teammate|d1|1': 200, 'u_teammate|d1|2': '403:forbidden', 'u_teammate|d1|3': '403:forbidden', 'u_teammate|d1|4': 200, 'u_teammate|d1|5': 201, 'u_teammate|d1|6': 200, 'u_teammate|d1|7': 204, 'u_teammate|d1|8': 200, 'u_teammate|d1|9': 200, 'u_teammate|d1|10': 200, 'u_teammate|d1|11': '400:invalid_title', 'u_teammate|d1|12': '400:invalid_email', 'u_teammate|d1|13': '400:passcode_too_short', 'u_teammate|d5|0': 200, 'u_teammate|d5|1': 200, 'u_teammate|d5|2': '403:forbidden', 'u_teammate|d5|3': '403:forbidden', 'u_teammate|d5|4': 200, 'u_teammate|d5|5': 201, 'u_teammate|d5|6': '404:not_found', 'u_teammate|d5|7': '404:not_found', 'u_teammate|d5|8': 200, 'u_teammate|d5|9': 200, 'u_teammate|d5|10': 200, 'u_teammate|d5|11': '400:invalid_title', 'u_teammate|d5|12': '400:invalid_email', 'u_teammate|d5|13': '404:not_found', 'u_teammate|tdoc|0': 200, 'u_teammate|tdoc|1': 200, 'u_teammate|tdoc|2': 200, 'u_teammate|tdoc|3': '400:has_links', 'u_teammate|tdoc|4': 200, 'u_teammate|tdoc|5': 201, 'u_teammate|tdoc|6': 200, 'u_teammate|tdoc|7': 204, 'u_teammate|tdoc|8': 200, 'u_teammate|tdoc|9': 200, 'u_teammate|tdoc|10': 200, 'u_teammate|tdoc|11': '400:invalid_title', 'u_teammate|tdoc|12': '400:invalid_email', 'u_teammate|tdoc|13': '400:passcode_too_short', 'u_teammate|tdoc2|0': 200, 'u_teammate|tdoc2|1': 200, 'u_teammate|tdoc2|2': 200, 'u_teammate|tdoc2|3': 204, 'u_teammate|tdoc2|4': 200, 'u_teammate|tdoc2|5': 201, 'u_teammate|tdoc2|6': '404:not_found', 'u_teammate|tdoc2|7': '404:not_found', 'u_teammate|tdoc2|8': 200, 'u_teammate|tdoc2|9': 200, 'u_teammate|tdoc2|10': 200, 'u_teammate|tdoc2|11': '400:invalid_title', 'u_teammate|tdoc2|12': '400:invalid_email', 'u_teammate|tdoc2|13': '404:not_found', 'u_teammate|d6|0': '404:not_found', 'u_teammate|d6|1': '404:not_found', 'u_teammate|d6|2': '404:not_found', 'u_teammate|d6|3': '404:not_found', 'u_teammate|d6|4': '404:not_found', 'u_teammate|d6|5': '404:not_found', 'u_teammate|d6|6': '404:not_found', 'u_teammate|d6|7': '404:not_found', 'u_teammate|d6|8': '404:not_found', 'u_teammate|d6|9': '404:not_found', 'u_teammate|d6|10': '404:not_found', 'u_teammate|d6|11': '404:not_found', 'u_teammate|d6|12': '404:not_found', 'u_teammate|d6|13': '404:not_found', 'u_teammate|nope|0': '404:not_found', 'u_teammate|nope|1': '404:not_found', 'u_teammate|nope|2': '404:not_found', 'u_teammate|nope|3': '404:not_found', 'u_teammate|nope|4': '404:not_found', 'u_teammate|nope|5': '404:not_found', 'u_teammate|nope|6': '404:not_found', 'u_teammate|nope|7': '404:not_found', 'u_teammate|nope|8': '404:not_found', 'u_teammate|nope|9': '404:not_found', 'u_teammate|nope|10': '404:not_found', 'u_teammate|nope|11': '404:not_found', 'u_teammate|nope|12': '404:not_found', 'u_teammate|nope|13': '404:not_found', 'u_other|d1|0': '404:not_found', 'u_other|d1|1': '404:not_found', 'u_other|d1|2': '404:not_found', 'u_other|d1|3': '404:not_found', 'u_other|d1|4': '404:not_found', 'u_other|d1|5': '404:not_found', 'u_other|d1|6': '404:not_found', 'u_other|d1|7': '404:not_found', 'u_other|d1|8': '404:not_found', 'u_other|d1|9': '404:not_found', 'u_other|d1|10': '404:not_found', 'u_other|d1|11': '404:not_found', 'u_other|d1|12': '404:not_found', 'u_other|d1|13': '404:not_found', 'u_other|d5|0': '404:not_found', 'u_other|d5|1': '404:not_found', 'u_other|d5|2': '404:not_found', 'u_other|d5|3': '404:not_found', 'u_other|d5|4': '404:not_found', 'u_other|d5|5': '404:not_found', 'u_other|d5|6': '404:not_found', 'u_other|d5|7': '404:not_found', 'u_other|d5|8': '404:not_found', 'u_other|d5|9': '404:not_found', 'u_other|d5|10': '404:not_found', 'u_other|d5|11': '404:not_found', 'u_other|d5|12': '404:not_found', 'u_other|d5|13': '404:not_found', 'u_other|tdoc|0': '404:not_found', 'u_other|tdoc|1': '404:not_found', 'u_other|tdoc|2': '404:not_found', 'u_other|tdoc|3': '404:not_found', 'u_other|tdoc|4': '404:not_found', 'u_other|tdoc|5': '404:not_found', 'u_other|tdoc|6': '404:not_found', 'u_other|tdoc|7': '404:not_found', 'u_other|tdoc|8': '404:not_found', 'u_other|tdoc|9': '404:not_found', 'u_other|tdoc|10': '404:not_found', 'u_other|tdoc|11': '404:not_found', 'u_other|tdoc|12': '404:not_found', 'u_other|tdoc|13': '404:not_found', 'u_other|tdoc2|0': '404:not_found', 'u_other|tdoc2|1': '404:not_found', 'u_other|tdoc2|2': '404:not_found', 'u_other|tdoc2|3': '404:not_found', 'u_other|tdoc2|4': '404:not_found', 'u_other|tdoc2|5': '404:not_found', 'u_other|tdoc2|6': '404:not_found', 'u_other|tdoc2|7': '404:not_found', 'u_other|tdoc2|8': '404:not_found', 'u_other|tdoc2|9': '404:not_found', 'u_other|tdoc2|10': '404:not_found', 'u_other|tdoc2|11': '404:not_found', 'u_other|tdoc2|12': '404:not_found', 'u_other|tdoc2|13': '404:not_found', 'u_other|d6|0': 200, 'u_other|d6|1': 200, 'u_other|d6|2': 200, 'u_other|d6|3': '400:has_links', 'u_other|d6|4': 200, 'u_other|d6|5': 201, 'u_other|d6|6': 200, 'u_other|d6|7': 204, 'u_other|d6|8': 200, 'u_other|d6|9': 200, 'u_other|d6|10': 200, 'u_other|d6|11': '400:invalid_title', 'u_other|d6|12': '400:invalid_email', 'u_other|d6|13': '400:passcode_too_short', 'u_other|nope|0': '404:not_found', 'u_other|nope|1': '404:not_found', 'u_other|nope|2': '404:not_found', 'u_other|nope|3': '404:not_found', 'u_other|nope|4': '404:not_found', 'u_other|nope|5': '404:not_found', 'u_other|nope|6': '404:not_found', 'u_other|nope|7': '404:not_found', 'u_other|nope|8': '404:not_found', 'u_other|nope|9': '404:not_found', 'u_other|nope|10': '404:not_found', 'u_other|nope|11': '404:not_found', 'u_other|nope|12': '404:not_found', 'u_other|nope|13': '404:not_found', 'null|d1|0': '401:unauthorized', 'null|d1|1': '401:unauthorized', 'null|d1|2': '401:unauthorized', 'null|d1|3': '401:unauthorized', 'null|d1|4': '401:unauthorized', 'null|d1|5': '401:unauthorized', 'null|d1|6': '401:unauthorized', 'null|d1|7': '401:unauthorized', 'null|d1|8': '401:unauthorized', 'null|d1|9': '401:unauthorized', 'null|d1|10': '401:unauthorized', 'null|d1|11': '401:unauthorized', 'null|d1|12': '401:unauthorized', 'null|d1|13': '401:unauthorized', 'null|d5|0': '401:unauthorized', 'null|d5|1': '401:unauthorized', 'null|d5|2': '401:unauthorized', 'null|d5|3': '401:unauthorized', 'null|d5|4': '401:unauthorized', 'null|d5|5': '401:unauthorized', 'null|d5|6': '401:unauthorized', 'null|d5|7': '401:unauthorized', 'null|d5|8': '401:unauthorized', 'null|d5|9': '401:unauthorized', 'null|d5|10': '401:unauthorized', 'null|d5|11': '401:unauthorized', 'null|d5|12': '401:unauthorized', 'null|d5|13': '401:unauthorized', 'null|tdoc|0': '401:unauthorized', 'null|tdoc|1': '401:unauthorized', 'null|tdoc|2': '401:unauthorized', 'null|tdoc|3': '401:unauthorized', 'null|tdoc|4': '401:unauthorized', 'null|tdoc|5': '401:unauthorized', 'null|tdoc|6': '401:unauthorized', 'null|tdoc|7': '401:unauthorized', 'null|tdoc|8': '401:unauthorized', 'null|tdoc|9': '401:unauthorized', 'null|tdoc|10': '401:unauthorized', 'null|tdoc|11': '401:unauthorized', 'null|tdoc|12': '401:unauthorized', 'null|tdoc|13': '401:unauthorized', 'null|tdoc2|0': '401:unauthorized', 'null|tdoc2|1': '401:unauthorized', 'null|tdoc2|2': '401:unauthorized', 'null|tdoc2|3': '401:unauthorized', 'null|tdoc2|4': '401:unauthorized', 'null|tdoc2|5': '401:unauthorized', 'null|tdoc2|6': '401:unauthorized', 'null|tdoc2|7': '401:unauthorized', 'null|tdoc2|8': '401:unauthorized', 'null|tdoc2|9': '401:unauthorized', 'null|tdoc2|10': '401:unauthorized', 'null|tdoc2|11': '401:unauthorized', 'null|tdoc2|12': '401:unauthorized', 'null|tdoc2|13': '401:unauthorized', 'null|d6|0': '401:unauthorized', 'null|d6|1': '401:unauthorized', 'null|d6|2': '401:unauthorized', 'null|d6|3': '401:unauthorized', 'null|d6|4': '401:unauthorized', 'null|d6|5': '401:unauthorized', 'null|d6|6': '401:unauthorized', 'null|d6|7': '401:unauthorized', 'null|d6|8': '401:unauthorized', 'null|d6|9': '401:unauthorized', 'null|d6|10': '401:unauthorized', 'null|d6|11': '401:unauthorized', 'null|d6|12': '401:unauthorized', 'null|d6|13': '401:unauthorized', 'null|nope|0': '401:unauthorized', 'null|nope|1': '401:unauthorized', 'null|nope|2': '401:unauthorized', 'null|nope|3': '401:unauthorized', 'null|nope|4': '401:unauthorized', 'null|nope|5': '401:unauthorized', 'null|nope|6': '401:unauthorized', 'null|nope|7': '401:unauthorized', 'null|nope|8': '401:unauthorized', 'null|nope|9': '401:unauthorized', 'null|nope|10': '401:unauthorized', 'null|nope|11': '401:unauthorized', 'null|nope|12': '401:unauthorized', 'null|nope|13': '401:unauthorized' };

const ROUTES = (doc, link) => [
  ['GET', `/api/documents/${doc}`, {}],
  ['PATCH', `/api/documents/${doc}`, { title: 'Renamed' }],
  ['POST', `/api/documents/${doc}/archive`, {}],
  ['DELETE', `/api/documents/${doc}`, {}],
  ['GET', `/api/documents/${doc}/links`, {}],
  ['POST', `/api/documents/${doc}/links`, { recipientEmail: 'x@y.example' }],
  ['PATCH', `/api/documents/${doc}/links/${link}`, { allowDownload: false }],
  ['DELETE', `/api/documents/${doc}/links/${link}`, {}],
  ['GET', `/api/documents/${doc}/analytics`, {}],
  ['GET', `/documents/${doc}/analytics`, {}],
  ['GET', `/documents/${doc}`, {}],
  ['PATCH', `/api/documents/${doc}`, { title: '' }],
  ['POST', `/api/documents/${doc}/links`, { recipientEmail: 'not-an-email' }],
  ['PATCH', `/api/documents/${doc}/links/${link}`, { passcode: '12' }],
];

async function setup() {
  const app = createApp();
  const as = user => ({ 'x-user': user });
  const t = (await app.handle({ method: 'POST', path: '/api/documents', headers: as('u_teammate'), body: { libraryId: 'lib_team', title: 'Tom doc' } })).body.document.id;
  const tl = (await app.handle({ method: 'POST', path: `/api/documents/${t}/links`, headers: as('u_teammate'), body: { recipientEmail: 'z@z.example' } })).body.link.id;
  const t2 = (await app.handle({ method: 'POST', path: '/api/documents', headers: as('u_teammate'), body: { libraryId: 'lib_team', title: 'Tom doc 2' } })).body.document.id;
  return { app, docs: { d1: 'd1', d5: 'd5', tdoc: t, tdoc2: t2, d6: 'd6', nope: 'd404' }, links: { d1: 'l2', d5: 'l2', tdoc: tl, tdoc2: tl, d6: 'l5', nope: 'l404' } };
}

test('A1: every route answers every caller exactly as before', async () => {
  const diffs = [];
  for (const user of ['u_owner', 'u_teammate', 'u_other', null]) {
    for (const target of ['d1', 'd5', 'tdoc', 'tdoc2', 'd6', 'nope']) {
      for (let i = 0; i < 14; i++) {
        const { app, docs, links } = await setup();
        const [m, p, b] = ROUTES(docs[target], links[target])[i];
        const r = await app.handle({ method: m, path: p, body: b, headers: user ? { 'x-user': user } : {} });
        const got = r.status === 200 || r.status === 201 || r.status === 204 ? r.status : `${r.status}:${r.body?.error}`;
        const want = EXPECTED[`${user}|${target}|${i}`];
        if (got !== want) {
          diffs.push(`${user} ${m} ${p.replace(docs[target], target)} -> ${got}, was ${want}`);
        }
      }
    }
  }
  assert.deepEqual(diffs, []);
});

test('A2: access.can answers each action, keeping the archive-by-uploader rule', async () => {
  const { app, docs } = await setup();
  const can = (u, a, id) => app.services.access.can(u, a, app.repos.documents.find(id));
  assert.equal(typeof app.services.access.can, 'function');
  const rows = [
    ['u_owner', 'view', 'd1', true],
    ['u_teammate', 'view', 'd1', true],
    ['u_other', 'view', 'd1', false],
    [null, 'view', 'd1', false],
    ['u_teammate', 'rename', 'd1', true],
    ['u_other', 'rename', 'd1', false],
    ['u_owner', 'archive', 'd1', true],
    ['u_teammate', 'archive', 'd1', false],
    ['u_owner', 'archive', docs.tdoc, false],
    ['u_teammate', 'archive', docs.tdoc, true],
    ['u_owner', 'delete', docs.tdoc2, true],
    ['u_teammate', 'delete', 'd5', false],
    ['u_teammate', 'delete', docs.tdoc2, true],
    ['u_teammate', 'share', 'd1', true],
    ['u_other', 'share', 'd1', false],
  ];
  for (const [u, a, id, want] of rows) {
    assert.equal(Boolean(can(u, a, id)), want, `${u} ${a} ${id}`);
  }
  const csv = async u => (await app.handle({ path: '/api/libraries/lib_team/audit.csv', headers: { 'x-user': u } })).status;
  assert.deepEqual([await csv('u_owner'), await csv('u_teammate'), await csv('u_other')], [200, 403, 404]);
});

test('A3: no route decides access itself any more', async () => {
  const offenders = (await sourceFiles('src/http'))
    .filter(f => /isMember\(|\.membership\(|ownerId\s*[!=]==|[!=]==\s*[\w.]*ownerId|role\s*[!=]==/.test(f.text))
    .map(f => f.file);
  assert.deepEqual(offenders, []);
  const access = (await sourceFiles('src/services')).find(f => f.file.endsWith('access.mjs'));
  assert.match(access.text, /\bcan\b/);
});

test('A4: the existing tests are unchanged', () => {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=MDR', process.env.EVAL_BASE_SHA, '--', 'test/'], { encoding: 'utf8' }).trim();
  assert.equal(out, '');
});
