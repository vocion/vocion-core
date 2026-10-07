/**
 * The tree summariser: what an agent reads of a repository's layout — the
 * shape, the exclusions, the depth cap, the host's truncation, the manifest
 * allow-list — and the reading policy for the manifests. Pure; the
 * repository is invented.
 */
import type { RepoTree } from '@/services/repo/provider';
import { describe, expect, it } from 'vitest';
import { fitTexts, pickManifests, summarizeTree } from './treeSummary';

const blob = (path: string, size = 10) => ({ path, type: 'blob' as const, size });
const dir = (path: string) => ({ path, type: 'tree' as const });

const northwind: RepoTree = {
  repo: 'Acme/northwind-core',
  ref: 'main',
  truncated: false,
  entries: [
    blob('README.md', 1200),
    blob('CLAUDE.md'),
    blob('package.json'),
    blob('package-lock.json', 90_000),
    blob('tsconfig.json'),
    blob('Dockerfile'),
    blob('docker-compose.yml'),
    blob('Makefile'),
    dir('src'),
    blob('src/index.ts'),
    blob('src/report.ts'),
    blob('src/styles.css'),
    dir('src/libs'),
    blob('src/libs/db.ts'),
    dir('src/libs/repo'),
    blob('src/libs/repo/tree.ts'),
    blob('src/libs/repo/tree.test.ts'),
    dir('infra'),
    dir('infra/terraform'),
    blob('infra/terraform/main.tf'),
    blob('infra/terraform/vars.tf'),
    dir('.github'),
    dir('.github/workflows'),
    blob('.github/workflows/ci.yml'),
    blob('.github/workflows/deploy.yaml'),
    dir('web'),
    blob('web/package.json'),
    blob('web/next.config.mjs'),
    blob('web/README.md'),
    dir('web/node_modules'),
    blob('web/node_modules/react/index.js'),
    blob('web/node_modules/react/package.json'),
    dir('dist'),
    blob('dist/index.js'),
    blob('vendor/lib.go'),
    blob('go.sum'),
    dir('config'),
    blob('config/database.ts'),
    blob('config/server.ts'),
    blob('api/src/deep/down/here.ts'),
  ],
};

describe('summarizeTree: the shape', () => {
  const s = summarizeTree(northwind);

  it('names the repository and ref, counts files and folders after exclusions, and reports the deepest path', () => {
    expect(s).toMatchObject({ repo: 'Acme/northwind-core', ref: 'main', truncated: false, maxDepth: 5 });
    // 29 blobs listed; minus the lockfiles (package-lock.json, go.sum), the two under node_modules, dist/index.js and vendor/lib.go.
    expect(s.fileCount).toBe(23);
    // 9 listed folders kept (web/node_modules and dist are excluded), plus the 4 only implied by a file: api, api/src, api/src/deep, api/src/deep/down.
    expect(s.directoryCount).toBe(13);
  });

  it('lists the top level with folders first by file count, each with its extension mix', () => {
    expect(s.topLevel.map(t => [t.path, t.files])).toEqual([
      ['src/', 6],
      ['web/', 3],
      ['.github/', 2],
      ['config/', 2],
      ['infra/', 2],
      ['api/', 1],
      ['CLAUDE.md', 1],
      ['Dockerfile', 1],
      ['Makefile', 1],
      ['README.md', 1],
      ['docker-compose.yml', 1],
      ['package.json', 1],
      ['tsconfig.json', 1],
    ]);
    expect(s.topLevel[0]!.extensions).toEqual([{ ext: 'ts', count: 5 }, { ext: 'css', count: 1 }]);
    expect(s.topLevel.find(t => t.path === 'Dockerfile')!.extensions).toEqual([{ ext: '(none)', count: 1 }]);
  });

  it('excludes dependencies, build output and lockfiles from every count and list, and names what it excluded', () => {
    expect(s.excluded).toEqual({ files: 6, directories: ['dist', 'vendor', 'web/node_modules'], lockfiles: ['go.sum', 'package-lock.json'] });
    expect(s.paths.some(p => p.includes('node_modules') || p.startsWith('dist') || p.startsWith('vendor') || p.endsWith('.lock') || p.endsWith('lock.json'))).toBe(false);
    expect(s.topLevel.some(t => ['dist/', 'vendor/', 'package-lock.json', 'go.sum'].includes(t.path))).toBe(false);
  });

  it('lists every path to three levels in path order with folders marked, and says how many lay deeper', () => {
    expect(s.paths).toContain('src/libs/repo/');
    expect(s.paths).toContain('.github/workflows/ci.yml');
    expect(s.paths).not.toContain('src/libs/repo/tree.ts');
    expect(s.paths).not.toContain('api/src/deep/down/');
    expect(s.folded).toEqual({ deeper: 4, overCap: 0 });
    expect([...s.paths].sort()).toEqual(s.paths);
  });

  it('finds the manifests to two levels (pipelines to three) by the allow-list, in reading order, shallower first within a kind', () => {
    expect(s.manifests).toEqual([
      { path: 'README.md', kind: 'readme', type: 'blob' },
      { path: 'web/README.md', kind: 'readme', type: 'blob' },
      { path: 'package.json', kind: 'package', type: 'blob' },
      { path: 'web/package.json', kind: 'package', type: 'blob' },
      { path: 'CLAUDE.md', kind: 'agent-notes', type: 'blob' },
      { path: 'Dockerfile', kind: 'container', type: 'blob' },
      { path: 'docker-compose.yml', kind: 'container', type: 'blob' },
      { path: 'infra/terraform', kind: 'deploy', type: 'tree' },
      { path: '.github/workflows/ci.yml', kind: 'pipeline', type: 'blob' },
      { path: '.github/workflows/deploy.yaml', kind: 'pipeline', type: 'blob' },
      { path: 'Makefile', kind: 'build', type: 'blob' },
      { path: 'tsconfig.json', kind: 'build', type: 'blob' },
      { path: 'web/next.config.mjs', kind: 'build', type: 'blob' },
      { path: 'config/database.ts', kind: 'framework-config', type: 'blob' },
      { path: 'config/server.ts', kind: 'framework-config', type: 'blob' },
    ]);
  });

  it('is deterministic: the same tree in another order gives the same summary', () => {
    const shuffled = { ...northwind, entries: [...northwind.entries].reverse() };

    expect(summarizeTree(shuffled)).toEqual(s);
  });
});

describe('summarizeTree: caps, truncation and odd input', () => {
  it('caps the path list and counts what the cap folded apart from what depth folded', () => {
    const entries = Array.from({ length: 50 }, (_, i) => blob(`src/f${String(i).padStart(2, '0')}.ts`));
    const s = summarizeTree({ repo: 'Acme/northwind-core', ref: 'main', truncated: false, entries: [...entries, blob('a/b/c/d.ts')] }, { maxPaths: 10 });

    // 50 files + src/ + a/, a/b/, a/b/c/ in depth = 54; a/b/c/d.ts is deeper.
    expect(s.paths).toHaveLength(10);
    expect(s.paths[0]).toBe('a/');
    expect(s.folded).toEqual({ deeper: 1, overCap: 44 });
  });

  it('passes the host\'s truncated flag through', () => {
    expect(summarizeTree({ repo: 'r', ref: 'main', truncated: true, entries: [blob('a.ts')] }).truncated).toBe(true);
  });

  it('never throws: odd entries are tidied or dropped, missing fields read as empty', () => {
    const odd = {
      repo: 'Acme/northwind-core',
      ref: 'main',
      truncated: false,
      entries: [
        { path: './README.md', type: 'blob' },
        { path: '/src//index.ts/', type: 'blob' },
        { path: 'src/index.ts', type: 'blob' },
        { path: '../escape.ts', type: 'blob' },
        { path: '', type: 'blob' },
        { path: 'x', type: 'commit' },
        { type: 'blob' },
        null,
        42,
        'a string',
      ],
    } as unknown as RepoTree;
    const s = summarizeTree(odd);

    expect(s.fileCount).toBe(2);
    expect(s.paths).toEqual(['README.md', 'src/', 'src/index.ts']);
    expect(summarizeTree({} as RepoTree)).toMatchObject({ repo: '', ref: '', truncated: false, fileCount: 0, directoryCount: 0, paths: [], manifests: [], topLevel: [] });
    expect(summarizeTree({ repo: 'r', ref: 'x', truncated: false, entries: 'nope' as unknown as [] }).fileCount).toBe(0);
  });
});

describe('the manifest reading policy', () => {
  it('pickManifests reads at most the first N files in order, names a folder rather than reading it, and says why each is skipped', () => {
    const { manifests } = summarizeTree(northwind);
    const { read, skipped } = pickManifests(manifests, 3);

    expect(read.map(m => m.path)).toEqual(['README.md', 'web/README.md', 'package.json']);
    expect(skipped).toEqual([
      { path: 'infra/terraform', reason: expect.stringContaining('a folder') },
      ...['web/package.json', 'CLAUDE.md', 'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', '.github/workflows/deploy.yaml', 'Makefile', 'tsconfig.json', 'web/next.config.mjs', 'config/database.ts', 'config/server.ts'].map(path => ({ path, reason: expect.stringContaining('past the 3 manifest reads') })),
    ]);
    expect(pickManifests([], 8)).toEqual({ read: [], skipped: [] });
  });

  it('fitTexts shares one budget: short files stay whole, the leftover goes to the long ones in order, the total never exceeds the budget', () => {
    const out = fitTexts([{ path: 'README.md', text: 'R'.repeat(1000) }, { path: 'package.json', text: 'P'.repeat(100) }, { path: 'Dockerfile', text: 'D'.repeat(600) }], 900);

    expect(out.map(f => [f.path, f.text.length, f.size, f.truncated])).toEqual([
      ['README.md', 500, 1000, true],
      ['package.json', 100, 100, false],
      ['Dockerfile', 300, 600, true],
    ]);
    expect(out.reduce((n, f) => n + f.text.length, 0)).toBe(900);
    expect(fitTexts([{ path: 'a', text: 'abc' }], 10)).toEqual([{ path: 'a', text: 'abc', size: 3, truncated: false }]);
    expect(fitTexts([], 10)).toEqual([]);
    expect(fitTexts([{ path: 'a', text: 'abc' }], 0)).toEqual([{ path: 'a', text: '', size: 3, truncated: true }]);
  });
});
