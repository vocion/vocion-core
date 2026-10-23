import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, request, timeIt } from './helpers.mjs';

// The search as it shipped, reimplemented here as the yardstick for results and time.
const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function oldSearch(docs, libraries, q, { archived = false } = {}) {
  const terms = words(q);
  if (!terms.length) {
    return [];
  }
  const hits = [];
  for (const entry of docs) {
    if (!libraries.includes(entry.libraryId) || (!archived && entry.archivedAt)) {
      continue;
    }
    const titleWords = words(entry.title);
    if (terms.every(t => titleWords.some(w => w.startsWith(t)))) {
      hits.push(entry);
    }
  }
  return hits.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, 50).map(e => e.id);
}

const VOCAB = ['board', 'deck', 'pricing', 'sheet', 'q1', 'q2', 'q3', 'q4', 'contract', 'draft', 'final', 'onboarding', 'guide', 'term', 'memo', 'budget', 'forecast', 'audit', 'report', 'plan', 'north', 'wind', 'kestrel', 'acme', 'legal', 'hr', 'sales', 'product', 'one-pager', 'roadmap', '2025', '2026', 'v2', 'notes', 'minutes', 'review', 'Ünïcode', 'O\'Brien'];
let seed = 7;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};

function bigApp(n = 20000) {
  const app = createApp();
  for (let i = 0; i < n; i++) {
    const title = Array.from({ length: 2 + rnd(5) }, () => VOCAB[rnd(VOCAB.length)]).join(rnd(4) ? ' ' : ' - ');
    app.db.insert('documents', { id: `s${String(i).padStart(5, '0')}`, libraryId: rnd(5) ? 'lib_team' : 'lib_other', ownerId: 'u_owner', title, mimeType: 'application/pdf', sizeBytes: 1, pageCount: 1, uploadedAt: '2026-09-01T00:00:00.000Z', archivedAt: rnd(10) ? null : '2026-09-15T00:00:00.000Z' });
  }
  return createApp({ db: app.db });
}

const QUERIES = ['board', 'q3 deck', 'dra', 'final contract', 'n', 'kestrel memo 2026', 'one', 'pager', 'o\'b', 'zzz', 'ün', '  ', 'review notes minutes', 'roadmap v', 'Q4 FORECAST', 'term-sheet', 'a', 'budget', 'plan', 'sales report'];

test('A1: results are identical to before on 20000 documents, for every query, user and archived setting', () => {
  const app = bigApp();
  const docs = app.repos.documents.all();
  for (const user of ['u_owner', 'u_other']) {
    const libs = app.repos.libraries.forUser(user);
    for (const q of QUERIES) {
      for (const archived of [false, true]) {
        assert.deepEqual(app.services.search.search(user, q, { archived }), oldSearch(docs, libs, q, { archived }), `${user} "${q}" archived=${archived}`);
      }
    }
  }
});

test('A2: a query over 20000 documents is at least 4 times faster than before', () => {
  const app = bigApp();
  const docs = app.repos.documents.all();
  const libs = app.repos.libraries.forUser('u_owner');
  const run = fn => () => {
    for (const q of QUERIES) {
      fn(q);
    }
  };
  app.services.search.search('u_owner', 'warm');
  const before = timeIt(run(q => oldSearch(docs, libs, q)), 3);
  const after = timeIt(run(q => app.services.search.search('u_owner', q)), 3);
  assert.ok(after * 4 <= before, `before ${before.toFixed(1)} ms, now ${after.toFixed(1)} ms for ${QUERIES.length} queries`);
});

test('A3: the index still follows creates, archives and deletes', async () => {
  const app = createApp();
  const doc = (await request(app, { method: 'POST', path: '/api/documents', user: 'u_owner', body: { libraryId: 'lib_team', title: 'Zephyr Plan' } })).body.document;
  assert.deepEqual(app.services.search.search('u_owner', 'zeph'), [doc.id]);
  await request(app, { method: 'POST', path: `/api/documents/${doc.id}/archive`, user: 'u_owner', body: {} });
  assert.deepEqual(app.services.search.search('u_owner', 'zeph'), []);
  assert.deepEqual(app.services.search.search('u_owner', 'zeph', { archived: true }), [doc.id]);
  await request(app, { method: 'POST', path: `/api/documents/${doc.id}/archive`, user: 'u_owner', body: { archived: false } });
  await request(app, { method: 'DELETE', path: `/api/documents/${doc.id}`, user: 'u_owner' });
  assert.deepEqual(app.services.search.search('u_owner', 'zeph'), []);
});
