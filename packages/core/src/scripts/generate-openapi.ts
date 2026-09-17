/**
 * Generate the OpenAPI document for `/api/v1` from the route handlers.
 *
 * The API gains endpoints most weeks. A spec written by hand beside it is
 * accurate until the first person forgets to update it, and after that it is
 * worse than nothing — a client integrates against a contract the server never
 * agreed to. So this reads the handlers instead: their locations give the
 * paths, their exports give the methods, their doc comments give the prose and
 * the query parameters, and their `jsonError` calls give the failures.
 *
 * The result is written to `src/libs/openapi/openapi.generated.json` and
 * committed, because the app serves it in production where `src/` is not on
 * disk. `generate-openapi.test.ts` regenerates it and fails when the committed
 * copy has fallen behind, so a new endpoint cannot ship undocumented.
 *
 * Run: npm run openapi:generate --workspace @vocion/core
 */

import type { OpenApiDocument } from '../libs/openapi/types';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../libs/openapi/buildDocument';
import { parseRouteModule, routeFileToApiPath } from '../libs/openapi/parseRouteModule';
import { fromRepoRoot } from '../libs/repo-root';

/** Where the documented endpoints live. */
export const V1_ROUTES_DIRECTORY = fromRepoRoot('packages/core/src/app/api/v1');

/** Where the generated document is committed. */
export const GENERATED_SPEC_PATH = fromRepoRoot('packages/core/src/libs/openapi/openapi.generated.json');

/** Files that define a route in the App Router. */
const ROUTE_FILE_NAME = 'route.ts';

/**
 * Every route file under a directory, as paths relative to it, sorted so the
 * generated document does not churn with the filesystem's ordering.
 * @param directory - The directory to walk, normally {@link V1_ROUTES_DIRECTORY}.
 */
export function listRouteFiles(directory: string): string[] {
  const found: string[] = [];
  const pending: string[] = [directory];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.name === ROUTE_FILE_NAME) {
        found.push(relative(directory, path));
      }
    }
  }
  return found.sort();
}

/**
 * Read every route file and build the document.
 * @param directory - Where the route files live.
 * @param version - The version to publish in `info.version`.
 */
export function generateOpenApiDocument(
  directory: string = V1_ROUTES_DIRECTORY,
  version: string = readPackageVersion(),
): OpenApiDocument {
  const operations = listRouteFiles(directory).flatMap(routeFile =>
    parseRouteModule(readFileSync(join(directory, routeFile), 'utf-8'), routeFileToApiPath(routeFile)),
  );
  return buildOpenApiDocument(operations, version);
}

/** The version this package publishes, so the spec and the app agree. */
function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(fromRepoRoot('packages/core/package.json'), 'utf-8')) as { version?: string };
  return packageJson.version ?? '0.0.0';
}

/**
 * The document as it is committed: pretty-printed, newline-terminated.
 * @param document
 */
export function serializeDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * CLI entrypoint: write the document and say what it covers.
 */
export function runGenerate(): number {
  const document = generateOpenApiDocument();
  writeFileSync(GENERATED_SPEC_PATH, serializeDocument(document), 'utf-8');
  const operationCount = Object.values(document.paths)
    .reduce((total, methods) => total + Object.keys(methods).length, 0);
  process.stdout.write(
    `openapi:generate — ${operationCount} operation(s) across ${Object.keys(document.paths).length} path(s) written to ${relative(fromRepoRoot('.'), GENERATED_SPEC_PATH)}\n`,
  );
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exit(runGenerate());
}
