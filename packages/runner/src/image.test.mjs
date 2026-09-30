import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// The image carries every module runner.mjs imports, and the hooks and settings it names. A
// hand-listed COPY once missed one and every worker built from it crashed at start
// (ERR_MODULE_NOT_FOUND, 2026-09-28).
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dockerfile = readFileSync(join(here, '..', 'Dockerfile'), 'utf8');

test('every local module a runner file imports is copied into the image', () => {
  const copied = name => dockerfile.includes('src/*.mjs') || dockerfile.includes(`src/${name}`);
  const sources = readdirSync(here).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  for (const file of sources) {
    const text = readFileSync(join(here, file), 'utf8');
    for (const m of text.matchAll(/from\s+['"]\.\/([\w.-]+\.mjs)['"]/g)) {
      assert.ok(copied(m[1]), `${file} imports ./${m[1]}, which the Dockerfile does not copy`);
    }
    assert.ok(copied(file), `${file} is not copied into the image`);
  }
});

test('the hooks the settings name are where the image puts them', () => {
  const settings = readFileSync(join(here, '..', 'claude-settings.json'), 'utf8');
  const hooks = [...settings.matchAll(/"command": "([^"]+)"/g)].map(m => m[1]);
  assert.ok(hooks.length >= 3);
  for (const h of hooks) {
    assert.match(h, /^\/opt\/vocion-runner\/hooks\/[\w-]+\.sh$/);
    assert.ok(readdirSync(join(here, '..', 'hooks')).includes(h.split('/').pop()), `${h} is not in hooks/`);
  }
  assert.ok(dockerfile.includes('COPY --chown=runner:runner hooks/ /opt/vocion-runner/hooks/'));
});
