import type { V1Route } from '../app/api/v1/[...path]/dispatch';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { matchV1Route } from '../app/api/v1/[...path]/dispatch';
import { listRouteFiles, V1_ROUTES_DIRECTORY } from './generate-openapi';
import { generateRouteTable, ROUTE_TABLE_PATH, routeTableProblems, runGenerate, segmentsOf } from './generate-v1-route-table';

/**
 * `/api/v1` is served by one catch-all route from a committed table (#1598).
 * A handler missing from the table is a 404 in production, so the table must
 * always be what the handler folders generate, and every handler must still be
 * reachable at the URL its folders give it.
 */

/**
 * A handler file as the generator reads it.
 * @param file - Path below `_routes/`.
 * @param source - The module source.
 */
function handlerFile(file: string, source = 'export async function GET() {}'): { file: string; segments: string[]; source: string } {
  return { file, segments: segmentsOf(file), source };
}

describe('the committed /api/v1 route table', () => {
  it('is what the handler folders generate today', () => {
    expect(
      readFileSync(ROUTE_TABLE_PATH, 'utf-8'),
      'routeTable.generated.ts is out of date: run `npm run v1-routes:generate` and commit the result',
    ).toBe(generateRouteTable());
  });

  it('routes every handler\'s own URL back to that handler', () => {
    const routes: V1Route[] = listRouteFiles(V1_ROUTES_DIRECTORY).map(file => ({ segments: segmentsOf(file), handlers: {} }));
    const misrouted = routes.filter((route) => {
      const url = route.segments.map(segment => (segment.startsWith('[') ? `value-of-${segment.slice(1, -1)}` : segment));
      return matchV1Route(routes, url)?.route !== route;
    });

    expect(routes.length).toBeGreaterThan(100);
    expect(misrouted.map(route => route.segments.join('/'))).toEqual([]);
  });
});

describe('handler folders the catch-all cannot serve the way Next did', () => {
  it('accepts plain folders and [param] folders', () => {
    expect(routeTableProblems([handlerFile('things/route.ts'), handlerFile('things/[id]/route.ts')])).toEqual([]);
  });

  it.each([
    ['a catch-all', 'things/[...rest]/route.ts'],
    ['an optional catch-all', 'things/[[...rest]]/route.ts'],
    ['a route group', '(admin)/things/route.ts'],
    ['a private folder', 'things/_draft/route.ts'],
    ['a handler at /api/v1 itself', 'route.ts'],
  ])('refuses %s', (_kind, file) => {
    expect(routeTableProblems([handlerFile(file)])).toHaveLength(1);
  });

  it('refuses two different [param] names in the same place, as Next does', () => {
    const problems = routeTableProblems([handlerFile('things/[id]/route.ts'), handlerFile('things/[slug]/notes/route.ts')]);

    expect(problems).toEqual([expect.stringContaining('different param names in the same place (id, slug)')]);
  });

  it.each([
    ['export const maxDuration = 300;'],
    ['export const dynamic = \'force-static\';'],
    ['const runtime = \'edge\';\nexport { runtime };'],
  ])('refuses route segment config a handler sets for itself, which Next would now ignore: %s', (config) => {
    const problems = routeTableProblems([handlerFile('things/route.ts', `${config}\nexport async function GET() {}`)]);

    expect(problems).toEqual([expect.stringContaining('exports route segment config')]);
  });

  it('fails the generator, instead of writing a table that serves a handler wrong', () => {
    const directory = mkdtempSync(join(tmpdir(), 'v1-routes-'));
    try {
      mkdirSync(join(directory, 'things', '[...rest]'), { recursive: true });
      writeFileSync(join(directory, 'things', '[...rest]', 'route.ts'), 'export async function GET() {}');

      expect(() => generateRouteTable(directory)).toThrow(/cannot be generated:\n- things\/\[\.\.\.rest\]\/route\.ts: "\[\.\.\.rest\]" is a catch-all/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('tells the person running the generator what to fix, exits 1 and writes nothing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'v1-routes-'));
    const outputPath = join(directory, 'routeTable.generated.ts');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      mkdirSync(join(directory, 'things', '[...rest]'), { recursive: true });
      writeFileSync(join(directory, 'things', '[...rest]', 'route.ts'), 'export async function GET() {}');

      const exitCode = runGenerate(directory, outputPath);
      const printed = stderr.mock.calls.map(call => String(call[0])).join('');

      expect(exitCode).toBe(1);
      expect(printed).toContain('nothing written');
      expect(printed).toContain('things/[...rest]/route.ts: "[...rest]" is a catch-all');
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      stderr.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
