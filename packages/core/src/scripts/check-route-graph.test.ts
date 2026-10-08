import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { moduleGraph, pathBetween, reachOf, routeEntries } from './check-route-graph';

const dirs: string[] = [];

/**
 * A throwaway `src/` holding the given files.
 * @param files - `src`-relative path to contents.
 */
function tree(files: Record<string, string>): string {
  const src = mkdtempSync(join(tmpdir(), 'route-graph-'));
  dirs.push(src);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(src, path)), { recursive: true });
    writeFileSync(join(src, path), contents);
  }
  return src;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the route module graph', () => {
  it('follows static, re-exported and dynamic imports, through the @/ alias', () => {
    const src = tree({
      'libs/Auth.ts': `import { a } from './a';\nexport { b } from '@/libs/b';\nexport async function f() { return import('@/services/Bus'); }\nexport const x = a;`,
      'libs/a.ts': 'export const a = 1;',
      'libs/b.ts': 'export const b = 2;',
      'services/Bus.ts': 'export const bus = 3;',
    });
    const graph = moduleGraph(src);

    expect(pathBetween(graph, 'libs/Auth.ts', 'services/Bus.ts')).toEqual(['libs/Auth.ts', 'services/Bus.ts']);
    expect(reachOf(graph, 'libs/Auth.ts')).toBe(4);
  });

  it('skips type-only imports and imports Turbopack is told to ignore, as the build does', () => {
    const src = tree({
      'libs/Auth.ts': `import type { Bus } from '@/services/Bus';\nexport async function f(): Promise<Bus> { return (await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ '@/services/Bus')).bus; }`,
      'services/Bus.ts': 'export type Bus = number;\nexport const bus = 3;',
    });

    expect(pathBetween(moduleGraph(src), 'libs/Auth.ts', 'services/Bus.ts')).toBeNull();
  });

  it('counts every page, route and layout under app/, plus the proxy', () => {
    const src = tree({
      'app/[locale]/page.tsx': 'export default 1;',
      'app/api/x/route.ts': 'export const GET = 1;',
      'app/[locale]/layout.tsx': 'export default 1;',
      'app/[locale]/Widget.tsx': 'export default 1;',
      'proxy.ts': 'export default 1;',
    });

    expect(routeEntries(src)).toEqual(['app/[locale]/layout.tsx', 'app/[locale]/page.tsx', 'app/api/x/route.ts', 'proxy.ts']);
  });
});
