/**
 * The Temporal worker must not statically import `libs/Logger`.
 *
 * `libs/Logger` has a top-level await. `npm run temporal:worker` runs
 * through tsx, which compiles this entrypoint as CommonJS, and a
 * top-level await there is fatal:
 *
 *   src/libs/Logger.ts:18:0: ERROR: Top-level await is currently not
 *   supported with the "cjs" output format
 *
 * The worker then refuses to start at all, taking every Temporal
 * schedule with it — source syncs, automations, mission checks and
 * Langfuse retention. It is a one-line mistake to make: add
 * `import { logger } from '@/libs/Logger'` to any service the worker
 * reaches and the process stops booting. It happened while adding
 * `LangfuseRetentionService`, and no unit test caught it, because
 * vitest loads modules as ESM where top-level await is fine.
 *
 * So this walks the worker's static import graph and fails if Logger is
 * in it. Modules that need to log use the deferred-import helper the
 * affected files already carry (see `libs/Langfuse.ts`), which this
 * check allows because a dynamic `import()` is not a static edge.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(__dirname, '..');
const WORKER_ENTRYPOINT = resolve(__dirname, 'temporal-worker.ts');
const FORBIDDEN_MODULE = resolve(SOURCE_ROOT, 'libs/Logger.ts');

/**
 * Static import specifiers in a source file.
 *
 * Deliberately misses dynamic `import('…')` calls: deferring the import
 * is the sanctioned fix, so a dynamic edge must not count.
 * @param source - File contents to scan.
 */
function staticImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // `import … from 'x'`, `import 'x'`, and `export … from 'x'`.
  const pattern = /(?:^|\n)\s*(?:import|export)(?:[\s\S]*?from)?\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Resolve an import specifier to a file inside this package, or null
 * for anything outside it (npm packages, node builtins).
 * @param specifier - The import specifier as written.
 * @param fromFile - File the import appears in.
 */
function resolveWithinPackage(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(SOURCE_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }

  // A bare specifier may name the file, the file without its extension,
  // or a directory with a barrel in it.
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    base,
  ];
  for (const candidate of candidates) {
    const isTypeScriptFile = candidate.endsWith('.ts') || candidate.endsWith('.tsx');
    if (isTypeScriptFile && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Every file reachable from an entrypoint by static imports, with the
 * path that got there — so a failure can name the chain rather than
 * just the offender.
 * @param entrypoint - File to start from.
 */
function staticImportGraph(entrypoint: string): Map<string, string[]> {
  const pathTo = new Map<string, string[]>([[entrypoint, [entrypoint]]]);
  const queue = [entrypoint];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const source = readFileSync(current, 'utf8');

    for (const specifier of staticImportSpecifiers(source)) {
      const resolved = resolveWithinPackage(specifier, current);
      if (!resolved || pathTo.has(resolved)) {
        continue;
      }
      pathTo.set(resolved, [...(pathTo.get(current) as string[]), resolved]);
      queue.push(resolved);
    }
  }

  return pathTo;
}

describe('temporal-worker static imports', () => {
  it('never reaches libs/Logger, whose top-level await is fatal under tsx CommonJS', () => {
    const graph = staticImportGraph(WORKER_ENTRYPOINT);
    const chain = graph.get(FORBIDDEN_MODULE);

    const readableChain = chain
      ?.map(file => file.replace(`${SOURCE_ROOT}/`, ''))
      .join('\n    → ');

    expect(
      chain,
      chain
        ? `The Temporal worker now statically imports libs/Logger, so it will not start:\n\n    ${readableChain}\n\n`
        + 'Use the deferred-import log helper instead — see libs/Langfuse.ts.'
        : undefined,
    ).toBeUndefined();
  });

  it('resolves a real graph, so a pass is not just a broken walker', () => {
    const graph = staticImportGraph(WORKER_ENTRYPOINT);

    // The worker imports the activities barrel, which pulls in services.
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.has(resolve(SOURCE_ROOT, 'services/temporal/activities/index.ts'))).toBe(true);
    expect(graph.has(resolve(SOURCE_ROOT, 'services/LangfuseRetentionService.ts'))).toBe(true);
  });
});
