import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// node --test packages/runner/src/preflight.test.mjs
import { describe, it } from 'node:test';
import { checkAllowedPaths, closestSibling, pathRoot, pathsMissingFailure } from './preflight.mjs';

// A tree after apps/old-* became apps/acme-*.
const DIRS = new Set(['apps', 'apps/acme-api', 'apps/acme-web', 'apps/acme-marketing', 'apps/acme-api/prisma', 'packages', 'packages/core', 'packages/core/src', 'packages/infra', 'docs', 'tools', 'tools/worker']);
const tree = {
  isDir: rel => DIRS.has(rel),
  listDir: rel => [...DIRS].filter(d => d.startsWith(rel ? `${rel}/` : '') && !d.slice(rel ? rel.length + 1 : 0).includes('/')).map(d => d.slice(rel ? rel.length + 1 : 0)),
};

// Task 230's allowed_paths, from plan #136 (written 2026-09-25).
const RUN_411_PATHS = [
  'packages/core/src/routes/item-send.ts',
  'packages/core/src/services/notify.ts',
  'apps/old-api/prisma/schema/core.prisma',
  'packages/core/src/jobs/remind.ts',
  'apps/old-web/src/routes/DocumentPage.tsx',
  'apps/acme-web/src/**',
  'packages/core/tests/**',
  'apps/old-api/tests/**',
  'apps/old-web/tests/**',
  'apps/acme-web/tests/**',
];

describe('the root a path is anchored to', () => {
  it('is the app or package for apps/ and packages/, the first directory otherwise', () => {
    assert.equal(pathRoot('apps/old-api/prisma/schema/core.prisma'), 'apps/old-api');
    assert.equal(pathRoot('packages/core/src/jobs/remind.ts'), 'packages/core');
    assert.equal(pathRoot('apps/acme-web/src/**'), 'apps/acme-web');
    assert.equal(pathRoot('docs/**'), 'docs');
    assert.equal(pathRoot('tools/worker/new-module.mjs'), 'tools');
  });

  it('is nothing for a file at the repo root or a leading wildcard', () => {
    assert.equal(pathRoot('package-lock.json'), null);
    assert.equal(pathRoot('**/*.md'), null);
  });
});

describe('the closest sibling', () => {
  it('matches by suffix: old-api -> acme-api, old-web -> acme-web', () => {
    const apps = ['acme-api', 'acme-web', 'acme-marketing'];
    assert.equal(closestSibling('old-api', apps), 'acme-api');
    assert.equal(closestSibling('old-web', apps), 'acme-web');
    assert.equal(closestSibling('old-marketing', apps), 'acme-marketing');
  });

  it('suggests nothing rather than guess on a tie or no shared suffix', () => {
    assert.equal(closestSibling('old-api', ['acme-api', 'ledger-api']), null);
    assert.equal(closestSibling('billing', ['acme-api', 'acme-web']), null);
  });

  it('breaks a suffix tie on the leading tokens', () => {
    assert.equal(closestSibling('acme-old-api', ['acme-api', 'ledger-api']), 'acme-api');
  });
});

describe('allowed paths against the tree', () => {
  it('run 411: names the apps/old-* paths missing and suggests apps/acme-*', () => {
    const c = checkAllowedPaths(RUN_411_PATHS, tree);
    assert.equal(c.ok, false);
    assert.deepEqual(c.missing, ['apps/old-api/prisma/schema/core.prisma', 'apps/old-web/src/routes/DocumentPage.tsx', 'apps/old-api/tests/**', 'apps/old-web/tests/**']);
    assert.deepEqual(c.suggest, ['apps/acme-api/prisma/schema/core.prisma', 'apps/acme-web/src/routes/DocumentPage.tsx', 'apps/acme-api/tests/**', 'apps/acme-web/tests/**']);
    assert.deepEqual(c.roots, [{ missing: 'apps/old-api', suggest: 'apps/acme-api' }, { missing: 'apps/old-web', suggest: 'apps/acme-web' }]);
  });

  it('lets a new file, or a new directory, under an existing app or package through', () => {
    const c = checkAllowedPaths(['packages/core/src/jobs/remind.ts', 'packages/core/tests/**', 'apps/acme-api/prisma/schema/migrations/**', 'docs/new.md', 'package-lock.json'], tree);
    assert.equal(c.ok, true);
    assert.deepEqual(c.missing, []);
  });

  it('names a missing path with no sibling to suggest', () => {
    const c = checkAllowedPaths(['services/mailer/**'], tree);
    assert.equal(c.ok, false);
    assert.deepEqual(c.missing, ['services/mailer/**']);
    assert.deepEqual(c.suggest, []);
    assert.deepEqual(c.roots, [{ missing: 'services/mailer', suggest: null }]);
  });

  it('works on a real directory tree through fs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
    for (const d of ['apps/acme-api/src', 'apps/acme-web/src', 'packages/core/src']) {
      fs.mkdirSync(path.join(dir, d), { recursive: true });
    }
    const fsTree = {
      isDir: (rel) => {
        try {
          return fs.statSync(path.join(dir, rel)).isDirectory();
        } catch {
          return false;
        }
      },
      listDir: (rel) => {
        try {
          return fs.readdirSync(path.join(dir, rel));
        } catch {
          return [];
        }
      },
    };
    const c = checkAllowedPaths(['apps/old-web/src/**', 'packages/core/src/new.ts'], fsTree);
    assert.deepEqual(c.missing, ['apps/old-web/src/**']);
    assert.deepEqual(c.suggest, ['apps/acme-web/src/**']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the typed failures', () => {
  it('paths_missing carries missing, suggest and a reason, and says nothing was changed', () => {
    const { failure, error } = pathsMissingFailure(checkAllowedPaths(RUN_411_PATHS, tree));
    assert.equal(failure.kind, 'paths_missing');
    assert.equal(failure.missing.length, 4);
    assert.deepEqual(failure.suggest.slice(0, 1), ['apps/acme-api/prisma/schema/core.prisma']);
    assert.match(failure.reason, /apps\/old-api \(did you mean apps\/acme-api\?\), apps\/old-web \(did you mean apps\/acme-web\?\)/);
    assert.match(error, /^paths missing: /);
    assert.match(error, /Nothing was changed/);
  });
});
