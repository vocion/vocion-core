import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentPage, libraryPage } from '../src/web/pages.mjs';
import { api, byTestId, rowsById, storeAt, text } from './helpers.mjs';

const off = (store, link = 'l1', doc = 'd1', allowDownload = false) => api(store, { method: 'PATCH', path: `/api/documents/${doc}/links/${link}`, body: { allowDownload }, userId: 'u_owner' });
// Start every link with downloads on, so a seed edit in src/data.mjs cannot decide the result.
const fresh = () => {
  const store = storeAt();
  for (const doc of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    for (const l of store.linksFor(doc)) {
      off(store, l.id, doc, true);
    }
  }
  return store;
};
const marks = store => Object.fromEntries(Object.entries(rowsById(libraryPage(store, 'u_owner'))).map(([id, r]) => [id, byTestId(r, 'mark-no-download').map(text)]));

test('A1: the mark', () => {
  const store = fresh();
  off(store);
  const m = marks(store);
  assert.deepEqual(m.d1, ['No download']);
  for (const id of ['d2', 'd3', 'd4', 'd5']) {
    assert.deepEqual(m[id], [], id);
  }
});

test('A2: back on, no mark', () => {
  const store = fresh();
  off(store);
  off(store, 'l1', 'd1', true);
  assert.deepEqual(marks(store).d1, []);
});

test('A3: the switch', () => {
  const store = fresh();
  off(store);
  const rows = byTestId(documentPage(store, 'u_owner', 'd1'), 'link-row');
  const l1 = rows.find(r => r.includes('data-id="l1"'));
  const l2 = rows.find(r => r.includes('data-id="l2"'));
  // The input tag with its quoted values blanked, so a handler that reads box.checked is not the attribute.
  const box = r => (r.match(/<input[^>]*data-testid="allow-download"[^>]*>/) || [''])[0].replace(/"[^"]*"|'[^']*'/g, '""');
  assert.match(box(l1), /^<input/);
  assert.match(l1, /type="checkbox"/);
  assert.doesNotMatch(box(l1), /\bchecked\b/);
  assert.match(box(l2), /\bchecked\b/);
  assert.match(text(l2), /Allow downloads/);
});
