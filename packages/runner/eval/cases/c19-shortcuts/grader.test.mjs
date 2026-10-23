import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryPage } from '../src/web/pages.mjs';
import { libraryKey } from '../src/web/shortcuts.mjs';

import { byTestId, storeAt, text } from './helpers.mjs';

const ids = ['d2', 'd1', 'd5'];
const key = (highlight, k, tagName = 'BODY') => libraryKey({ ids, highlight }, { key: k, target: { tagName } });

test('A1: moving the highlight', () => {
  assert.equal(key(-1, 'ArrowDown').highlight, 0);
  assert.equal(key(0, 'ArrowDown').highlight, 1);
  assert.equal(key(2, 'ArrowDown').highlight, 2);
  assert.equal(key(1, 'ArrowUp').highlight, 0);
  assert.equal(key(0, 'ArrowUp').highlight, 0);
  assert.equal(key(0, 'j').highlight, 1);
  assert.equal(key(1, 'k').highlight, 0);
});

test('A2: row actions', () => {
  assert.deepEqual(key(1, 'Enter').action, { type: 'open', id: 'd1' });
  assert.deepEqual(key(1, 's').action, { type: 'star', id: 'd1' });
  assert.deepEqual(key(2, 'a').action, { type: 'archive', id: 'd5' });
  assert.deepEqual(key(0, 'c').action, { type: 'copy-link', id: 'd2' });
  assert.equal(key(1, 's').highlight, 1);
});

test('A3: the sheet', () => {
  assert.deepEqual(key(-1, '?').action, { type: 'help' });
  const sheet = text(byTestId(libraryPage(storeAt(), 'u_owner'), 'shortcut-help')[0]);
  assert.match(sheet, /Enter/);
  assert.match(sheet, /\?/);
});

test('A4: no highlight, no row action', () => {
  for (const k of ['Enter', 's', 'a', 'c']) {
    const r = key(-1, k);
    assert.equal(r.action, null, k);
    assert.equal(r.highlight, -1);
  }
});

test('A5: nothing while typing', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(key(0, 'ArrowDown', tag), null);
    assert.equal(key(0, 's', tag), null);
  }
});
