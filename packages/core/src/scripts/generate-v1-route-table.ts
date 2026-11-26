/**
 * Generate the table that serves `/api/v1` through one route entry (#1598).
 *
 * Every v1 handler reaches about 1,300 modules through `_routes/_shared.ts`,
 * and building the handlers as 114 route entries cost about 1.8 to 3.5 GiB
 * more peak build memory than one entry (`src/app/api/v1/README.md` has the
 * measurements). The handlers therefore
 * live under the private folder `src/app/api/v1/_routes/`, which Next does not
 * route, and the one real route, `src/app/api/v1/[...path]/route.ts`, imports
 * this table and hands each request to the handler Next would have picked
 * (`src/app/api/v1/[...path]/dispatch.ts`).
 *
 * Next used to check the route folders for us; now this does, and refuses to
 * write a table it cannot serve the way Next would: a catch-all, optional,
 * group or private folder, two different `[param]` names in the same place, a
 * route at `/api/v1` itself, or a handler exporting route segment config
 * (`dynamic`, `maxDuration`, ...), which only the catch-all's own exports can
 * set now.
 *
 * The table is written to `src/app/api/v1/[...path]/routeTable.generated.ts`
 * and committed. `generate-v1-route-table.test.ts` regenerates it and fails
 * when the committed copy is stale, so a new handler cannot ship unrouted.
 *
 * Run: `npm run v1-routes:generate`, from the repo root or `packages/core`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { fromRepoRoot } from '../libs/repo-root';
import { listRouteFiles, V1_ROUTES_DIRECTORY } from './generate-openapi';

/** Where the generated table is committed. */
export const ROUTE_TABLE_PATH = fromRepoRoot('packages/core/src/app/api/v1/[...path]/routeTable.generated.ts');

/**
 * Route segment config Next reads from a route file
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/).
 * Next reads it from the catch-all only, so a handler that set its own would
 * be silently ignored; the generator refuses it instead.
 */
export const SEGMENT_CONFIG_EXPORTS: ReadonlySet<string> = new Set([
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'ensureStatic',
  'instant',
  'prefetch',
  'experimental_ppr',
  'generateStaticParams',
]);

/**
 * The handler folders can't be served through the catch-all the way Next
 * would serve them. The message names each file and what to change.
 */
export class RouteTableError extends Error {
  override name = 'RouteTableError';
}

/** A static folder name the catch-all can match literally. */
const STATIC_SEGMENT = /^[\w.-]+$/;

/** A `[param]` folder name: one segment, not a catch-all. */
const PARAM_SEGMENT = /^\[(\w+)\]$/;

/** One handler file and the URL segments its folders give it. */
export type V1RouteFile = {
  /** Path of the `route.ts` below `_routes/`, e.g. `objects/[id]/analyze/route.ts`. */
  file: string;
  /** Its folder names, e.g. `['objects', '[id]', 'analyze']`. */
  segments: string[];
};

/**
 * The folder names a route file sits under.
 * @param file - Path of the `route.ts` below `_routes/`.
 */
export function segmentsOf(file: string): string[] {
  return file.split('/').slice(0, -1);
}

/**
 * Why a folder name cannot be served by the catch-all, or null when it can.
 * @param segment - One folder name.
 */
export function segmentProblem(segment: string): string | null {
  if (segment.startsWith('_')) {
    return `"${segment}" is a private folder, which Next never routed`;
  }
  if (PARAM_SEGMENT.test(segment) || STATIC_SEGMENT.test(segment)) {
    return null;
  }
  return `"${segment}" is a catch-all, optional, group, slot or intercepting folder, which the v1 dispatcher does not support`;
}

/**
 * The names a module exports at its top level.
 * @param source - The module's TypeScript source.
 */
export function exportedNames(source: string): string[] {
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const names: string[] = [];
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
        }
      }
    } else if (exported && ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.push(element.name.text);
      }
    }
  }
  return names;
}

/**
 * Every reason the route files cannot be served through the catch-all the way
 * Next served them. Empty when the table can be written.
 * @param routeFiles - Every handler file, with its source.
 */
export function routeTableProblems(routeFiles: ReadonlyArray<V1RouteFile & { source: string }>): string[] {
  const problems: string[] = [];
  const paramNamesByPlace = new Map<string, Set<string>>();
  for (const { file, segments, source } of routeFiles) {
    if (segments.length === 0) {
      problems.push(`${file}: a handler at /api/v1 itself is not reachable through api/v1/[...path]`);
    }
    for (const [index, segment] of segments.entries()) {
      const problem = segmentProblem(segment);
      if (problem !== null) {
        problems.push(`${file}: ${problem}`);
      }
      const param = PARAM_SEGMENT.exec(segment);
      if (param) {
        const place = segments.slice(0, index).map(earlier => (PARAM_SEGMENT.test(earlier) ? '[]' : earlier)).join('/');
        const names = paramNamesByPlace.get(place) ?? new Set<string>();
        names.add(param[1] as string);
        paramNamesByPlace.set(place, names);
      }
    }
    const config = exportedNames(source).filter(name => SEGMENT_CONFIG_EXPORTS.has(name));
    if (config.length > 0) {
      problems.push(`${file}: exports route segment config (${config.join(', ')}); set it on api/v1/[...path]/route.ts, which applies it to every v1 handler`);
    }
  }
  for (const [place, names] of paramNamesByPlace) {
    if (names.size > 1) {
      problems.push(`/${place}: different param names in the same place (${[...names].sort().join(', ')}); Next refuses this, so the dispatcher does too`);
    }
  }
  return problems;
}

/**
 * The import name for a handler module: its segments joined, `[id]` as `$id`.
 * @param segments - The module's folder names.
 */
export function importNameFor(segments: readonly string[]): string {
  const parts = segments.map(segment => segment.replace(PARAM_SEGMENT, '$$$1').replace(/[^\w$]/g, '_'));
  return `route_${parts.join('__')}`;
}

/**
 * The generated module's source.
 * @param routeFiles - Every handler file, sorted by path.
 */
export function renderRouteTable(routeFiles: readonly V1RouteFile[]): string {
  const names = routeFiles.map(route => importNameFor(route.segments));
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new RouteTableError(`Two v1 handlers would share the import name ${duplicate}; rename one of their folders.`);
  }
  const imports = routeFiles.map((route, index) =>
    `import * as ${names[index]} from '../_routes/${route.file.replace(/\.ts$/, '')}';`);
  const entries = routeFiles.map((route, index) =>
    `  { segments: [${route.segments.map(segment => `'${segment}'`).join(', ')}], handlers: ${names[index]} },`);
  return [
    '/**',
    ' * Generated by `src/scripts/generate-v1-route-table.ts` (#1598). Do not edit:',
    ' * after adding, moving or deleting a handler under `src/app/api/v1/_routes/`, run',
    ' * `npm run v1-routes:generate --workspace @vocion/core`.',
    ' */',
    '',
    'import type { V1Route } from \'./dispatch\';',
    ...imports,
    '',
    '/** Every v1 handler, with the folder names that give its URL. */',
    'export const V1_ROUTES: readonly V1Route[] = [',
    ...entries,
    '];',
    '',
  ].join('\n');
}

/**
 * Read every handler file under a directory, check it, and render the table.
 * Throws with every problem found, so a bad route fails the generator and the
 * test that guards the committed table instead of being served wrong.
 * @param directory - Where the handlers live, normally {@link V1_ROUTES_DIRECTORY}.
 */
export function generateRouteTable(directory: string = V1_ROUTES_DIRECTORY): string {
  const routeFiles = listRouteFiles(directory).map(file => ({
    file,
    segments: segmentsOf(file),
    source: readFileSync(join(directory, file), 'utf-8'),
  }));
  const problems = routeTableProblems(routeFiles);
  if (problems.length > 0) {
    throw new RouteTableError(`The /api/v1 route table cannot be generated:\n- ${problems.join('\n- ')}`);
  }
  return renderRouteTable(routeFiles);
}

/**
 * CLI entrypoint: write the table and say what it covers. When the handler
 * folders can't be served (a {@link RouteTableError}), it prints what to fix,
 * writes nothing and returns 1, so the person sees the reason, not a stack
 * trace. Any other error still throws.
 * @param directory - Where the handlers live, normally {@link V1_ROUTES_DIRECTORY}.
 * @param outputPath - Where the table goes, normally {@link ROUTE_TABLE_PATH}.
 */
export function runGenerate(directory: string = V1_ROUTES_DIRECTORY, outputPath: string = ROUTE_TABLE_PATH): number {
  let table: string;
  try {
    table = generateRouteTable(directory);
  } catch (error) {
    if (!(error instanceof RouteTableError)) {
      throw error;
    }
    process.stderr.write(`v1-routes:generate — nothing written. ${error.message}\n`);
    return 1;
  }
  writeFileSync(outputPath, table, 'utf-8');
  const count = listRouteFiles(directory).length;
  process.stdout.write(`v1-routes:generate — ${count} handler(s) written to ${relative(fromRepoRoot('.'), outputPath)}\n`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exit(runGenerate());
}
