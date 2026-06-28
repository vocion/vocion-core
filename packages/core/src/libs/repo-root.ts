import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

/**
 * Find the monorepo root on disk.
 *
 * Post-Phase-B the Next.js app lives at `packages/core/` but everything
 * tenant-owned (`workspace/<org>/`, `docs/`, `requirements/`) still lives at
 * repo root. cwd depends on how a script was invoked — `npm run ...
 * --workspace` lands in `packages/core/`, while direct `npm ... ` from
 * root stays at root. Rather than guess, walk up from cwd until we find
 * the umbrella package.json (`"name": "vocion"` + `"workspaces"`).
 *
 * Result is memoized per process.
 */

let cached: string | null = null;

export function getRepoRoot(): string {
  if (cached) {
    return cached;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string; workspaces?: unknown };
        if (pkg.name === 'vocion' && pkg.workspaces) {
          cached = dir;
          return dir;
        }
      } catch { /* malformed — keep walking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  // Fallback: cwd. Lets test runs in fresh scratch dirs work.
  cached = process.cwd();
  return cached;
}

/**
 * Resolve a repo-relative path (e.g. `workspace/metacto`, `docs/README.md`)
 * to an absolute path anchored at the monorepo root.
 * @param segments
 */
export function fromRepoRoot(...segments: string[]): string {
  return resolve(getRepoRoot(), ...segments);
}
