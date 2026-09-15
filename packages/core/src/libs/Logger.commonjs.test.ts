/**
 * `libs/Logger` must load under tsx in CommonJS mode.
 *
 * The Temporal worker and every CLI script run through tsx, which compiles
 * this package as CommonJS because it has no `"type": "module"`. A
 * top-level await in a module tsx transforms that way is a hard error:
 *
 *   Logger.ts:18:0: ERROR: Top-level await is currently not supported
 *   with the "cjs" output format
 *
 * `scripts/temporal-worker.imports.test.ts` keeps Logger out of the
 * worker's static import graph, but the mission-check path reaches it
 * anyway: AgentService imports `agents/harness` dynamically and harness
 * imports Logger statically. On 2026-09-10 that failed every scheduled
 * run on the Veerio dev box in 1.5 seconds, before any model call.
 *
 * Vitest loads modules as ESM, where the await is legal, so a unit test
 * that imports Logger directly cannot catch this. This one spawns tsx the
 * way the worker does and requires the module from a CommonJS entry.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '../..');
const TSX_BIN = resolve(PACKAGE_ROOT, '../../node_modules/.bin/tsx');

describe('libs/Logger under tsx (CommonJS)', () => {
  it('loads from a CommonJS entry without a transform error', () => {
    expect(existsSync(TSX_BIN)).toBe(true);

    let output = '';
    try {
      output = execFileSync(
        process.execPath,
        [TSX_BIN, '-e', 'require("./src/libs/Logger.ts"); process.stdout.write("logger loaded")'],
        {
          cwd: PACKAGE_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
          env: {
            ...process.env,
            // Env.ts validates on import; these mirror the CI unit-test values.
            DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vocion_test',
            AUTH_SECRET: process.env.AUTH_SECRET ?? 'ci-only-secret-not-used-by-unit-tests',
          },
        },
      );
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message: string };
      throw new Error(`tsx could not load libs/Logger:\n${failure.stderr ?? failure.stdout ?? failure.message}`);
    }

    expect(output).toContain('logger loaded');
  });
});
