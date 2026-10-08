/**
 * The build-time loader for `@vocion/enterprise` (`libs/extensions.ts`).
 *
 * Core builds and runs the same without it. When a deployment provides an
 * enterprise package, this finds it, snapshots it into the gitignored
 * `src/enterprise-ext/`, and says what `@vocion/enterprise` and
 * `@vocion/enterprise/client` resolve to. Core imports exactly two
 * specifiers, `@vocion/enterprise/index` and `@vocion/enterprise/client`.
 * `next.config.ts` calls this once at config load and aliases both to what it
 * returns. `tsconfig.json` maps `@vocion/enterprise/*` to the snapshot first
 * and the stubs second, which is what `tsc` and `tsx` (the scripts and the
 * worker) resolve. Core's vitest projects always use the stubs; the
 * `enterprise` projects use the package (`vitest.config.mts`).
 *
 * Why a snapshot and not a path or a symlink: Turbopack compiles only files
 * under the project root and refuses an alias or a symlink that escapes it
 * (the same constraint as `@wsx/registry` in `next.config.ts`). Inside
 * `src/`, the package also resolves core's `@/` alias and core's
 * `node_modules`, which is how it imports core.
 *
 * Where a deploy puts the package, first match wins:
 *
 * 1. `VOCION_ENTERPRISE_DIR`, an absolute path or one relative to this
 *    package (`packages/core`).
 * 2. `packages/enterprise` in this monorepo, beside `packages/core` (a
 *    checkout; `packages/*` is not an npm workspace glob, so it touches no
 *    lockfile).
 * 3. `node_modules/@vocion/enterprise`, here or at the monorepo root (an npm
 *    alias or a git dependency installed by the deploy).
 *
 * A package is recognised by an `index.ts` at its root exporting
 * `extensions`. A `client.ts` beside it, exporting `clientExtensions`, is
 * optional. Its `package.json` may list, under `vocion.coreTests`, globs of
 * its own tests that run inside core's vitest setup (`vitest.config.mts`).
 * Set `VOCION_ENTERPRISE=off` to build without a package that is present.
 */

import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import process from 'node:process';

/** Where the snapshot lives, relative to `packages/core`. Gitignored. */
export const ENTERPRISE_SNAPSHOT_DIR = 'src/enterprise-ext';

/** The stubs the two specifiers resolve to without a package, relative to `packages/core`. */
export const ENTERPRISE_NONE = { server: './src/libs/enterprise-none/index.ts', client: './src/libs/enterprise-none/client.ts' };

/** What the loader found. Alias values are `packages/core`-relative specifiers, as Turbopack wants. */
export type EnterpriseLink = {
  /** The package's directory, or null when none was found. */
  source: string | null;
  /** What `@vocion/enterprise/index` resolves to. */
  server: string;
  /** What `@vocion/enterprise/client` resolves to. */
  client: string;
  /** Globs, relative to `packages/core`, of the package's tests to run in core's vitest setup. */
  coreTests: string[];
};

/**
 * Where the enterprise package is, or null.
 * @param coreDir - Absolute path of `packages/core`.
 * @param env - The environment to read (default `process.env`).
 */
export function findEnterprise(coreDir: string, env: Record<string, string | undefined> = process.env): string | null {
  if (env.VOCION_ENTERPRISE?.trim().toLowerCase() === 'off') {
    return null;
  }
  const configured = env.VOCION_ENTERPRISE_DIR?.trim();
  const candidates = configured
    ? [isAbsolute(configured) ? configured : join(coreDir, configured)]
    : [join(coreDir, '../enterprise'), join(coreDir, 'node_modules/@vocion/enterprise'), join(coreDir, '../../node_modules/@vocion/enterprise')];
  return candidates.find(dir => existsSync(join(dir, 'index.ts'))) ?? null;
}

/**
 * The package's `vocion.coreTests` globs, or none.
 * @param dir - The package's directory.
 */
function declaredCoreTests(dir: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { vocion?: { coreTests?: unknown } };
    const globs = pkg.vocion?.coreTests;
    return Array.isArray(globs) ? globs.filter((g): g is string => typeof g === 'string' && !g.startsWith('/') && !g.includes('..')) : [];
  } catch {
    return [];
  }
}

/**
 * Snapshot the enterprise package into `src/enterprise-ext/` (or clear a stale
 * snapshot when there is none) and say what the two specifiers resolve to.
 * @param coreDir - Absolute path of `packages/core`.
 * @param env - The environment to read (default `process.env`).
 */
export function linkEnterprise(coreDir: string, env: Record<string, string | undefined> = process.env): EnterpriseLink {
  const snapshot = join(coreDir, ENTERPRISE_SNAPSHOT_DIR);
  const source = findEnterprise(coreDir, env);
  // The snapshot of a package that is no longer there must not be built.
  rmSync(snapshot, { recursive: true, force: true });
  if (!source) {
    return { source: null, ...ENTERPRISE_NONE, coreTests: [] };
  }
  cpSync(source, snapshot, {
    recursive: true,
    dereference: true,
    filter: path => !/(?:^|[/\\])(?:node_modules|\.git)(?:[/\\]|$)/.test(relative(source, path)),
  });
  const rel = `./${ENTERPRISE_SNAPSHOT_DIR}`;
  return {
    source,
    server: `${rel}/index.ts`,
    client: existsSync(join(snapshot, 'client.ts')) ? `${rel}/client.ts` : ENTERPRISE_NONE.client,
    coreTests: declaredCoreTests(source).map(glob => `${ENTERPRISE_SNAPSHOT_DIR}/${glob}`),
  };
}
