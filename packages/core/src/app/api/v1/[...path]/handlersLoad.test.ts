/**
 * Every v1 handler module loads on its own (#1598).
 *
 * One route, `route.ts` beside this file, imports all the handlers under
 * `_routes/` through `routeTable.generated.ts`. So a handler module that
 * throws while it loads (a top-level import that fails, a setting read at load
 * time) fails every `/api/v1` request, not only its own path. Before #1598
 * each handler was its own route and broke alone.
 *
 * This test loads each handler by itself, so a failure names the handler,
 * then loads the catch-all route the way Next does.
 */
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { listRouteFiles, V1_ROUTES_DIRECTORY } from '@/scripts/generate-openapi';
import { HTTP_METHODS } from './dispatch';

vi.mock('@/libs/DB');
// next-auth imports `next/server` without an extension, which Node's loader
// refuses outside Next, so core tests stub the auth module (vitest.config.mts).
vi.mock('@/libs/Auth', () => ({ auth: vi.fn(), clerkAuth: vi.fn() }));

/** The first handler loaded pulls in most of the server, about 1,300 modules. */
const FIRST_LOAD_TIMEOUT_MS = 120_000;

/** Every handler file, as a path below `_routes/`, e.g. `agents/route.ts`. */
const HANDLER_FILES = listRouteFiles(V1_ROUTES_DIRECTORY);

/**
 * The HTTP methods a route module exports as functions, the way Next reads them.
 * @param routeModule - The module's exports.
 * @returns The method names, in {@link HTTP_METHODS} order.
 */
function exportedMethods(routeModule: Record<string, unknown>): string[] {
  return HTTP_METHODS.filter(method => typeof routeModule[method] === 'function');
}

/**
 * Loads one handler module by itself and checks it serves at least one method.
 * @param handlerFile - Path below `_routes/`, e.g. `agents/route.ts`.
 */
async function expectHandlerLoads(handlerFile: string): Promise<void> {
  const routeModule = (await import(join(V1_ROUTES_DIRECTORY, handlerFile))) as Record<string, unknown>;

  expect(exportedMethods(routeModule), `_routes/${handlerFile} exports no HTTP method`).not.toHaveLength(0);
}

/** Loads the catch-all route, which imports every handler, and checks it serves every method. */
async function expectCatchAllLoads(): Promise<void> {
  const catchAll = (await import('./route')) as Record<string, unknown>;

  expect(exportedMethods(catchAll)).toEqual([...HTTP_METHODS]);
}

it('finds the v1 handlers to check', () => expect(HANDLER_FILES).not.toHaveLength(0));

it.each(HANDLER_FILES)('_routes/%s loads on its own and exports an HTTP method', expectHandlerLoads, FIRST_LOAD_TIMEOUT_MS);

it('the catch-all route loads every handler and serves every method', expectCatchAllLoads, FIRST_LOAD_TIMEOUT_MS);
