/**
 * Keep the production build's size in check by keeping each route's module
 * graph small.
 *
 * Turbopack compiles everything a route reaches into that route, `await
 * import()` targets included, so the build's compile time and memory grow
 * with the SUM over every route of the modules it reaches, not with the size
 * of the code. One edge from a module nearly every route imports to one that
 * reaches the whole server multiplies the server by the number of routes.
 * That happened between v5.12.0 and v5.15.1: the sign-in path started
 * importing the event bus, `libs/Auth.ts` went from reaching 50 modules to
 * 945, and the image build ran out of time on the deploy runner and out of
 * memory on a 32 GB box. Enterprise made it worse through
 * `libs/identity/signInProviders.ts` → `libs/extensions.ts`.
 *
 * Two rules, both read from source in a few seconds, with no build:
 *
 * 1. **Hot modules stay light.** A module most routes import must not reach
 *    a hub that reaches the whole server ({@link FORBIDDEN_REACH}). Emit an
 *    event from one through `libs/eventBridge.ts`.
 * 2. **A budget for the whole graph.** The sum, over every route, of the
 *    modules it reaches stays under {@link REACH_BUDGET}.
 *
 * The graph is approximate: TypeScript drops type-only imports, imports
 * marked `turbopackIgnore` are skipped as Turbopack skips them, and the
 * enterprise and workspace aliases resolve to core's stubs.
 *
 * Run: npm run check:route-graph
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Modules nearly every route imports, and hubs none of them may reach. The
 * event bus reaches workflows, agents, the tools and every connector.
 */
export const FORBIDDEN_REACH: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'libs/Auth.ts', to: 'services/EventService.ts' },
  { from: 'libs/extensions.ts', to: 'services/EventService.ts' },
  { from: 'services/SourceCredentialService.ts', to: 'services/EventService.ts' },
];

/**
 * The sum over every route of the modules it reaches, as this check counts
 * them: 163,679 at v5.12.0, the last release that built on the deploy runner;
 * 214,945 at v5.15.1, which did not; 184,023 when this was set (2026-10-08).
 * Raise it deliberately, with a reason, never to make a red check green:
 * first look for the edge that put a large graph under a widely imported
 * module.
 *
 * Raised to 196,500 on 2026-10-09, with that look taken. main stood at
 * 195,057 after the effort-levels change (#1294): the growth is ordinary
 * modules reached through the agent tool registry, which 186 of the 275
 * routes reach (via `app/api/v1/_shared.ts` → `writeApi` → `ReviewService` →
 * `AgentService`, and `WorkflowService` → `AgentService`), so each new module
 * there costs about 186. No single edge is to blame: cutting any one edge on
 * the heaviest route (`dashboard/agents/[slug]`) saves at most 40 modules,
 * because the server graph reaches the hub by many paths. The rule that
 * catches a real blow-up — a hot module reaching the whole server
 * (`FORBIDDEN_REACH`) — is unchanged. The structural fix is to stop the API
 * write path reaching the agent loop at all, which is its own change.
 */
export const REACH_BUDGET = 196_500;

/** File names Next treats as a route entry under `app/`. */
const ENTRY_FILE = /^(?:page|route|layout|template|default|loading|error|not-found)\.tsx?$/;

/** A dynamic import Turbopack is told to leave alone. */
const IGNORED_IMPORT = /import\(\s*\/\*\s*turbopackIgnore:\s*true\s*\*\/(?:\s*\/\*[^*]*\*\/)*\s*['"]([^'"]+)['"]/g;

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'];

/** The import graph of `src/`, keyed by `src`-relative path. */
export type ModuleGraph = {
  /** `src`-relative paths each module imports. */
  edges: (file: string) => string[];
};

/**
 * The import graph of a source tree, built lazily as it is walked.
 * @param srcDir - Absolute path of `packages/core/src`.
 */
export function moduleGraph(srcDir: string): ModuleGraph {
  const aliases: Record<string, string> = {
    '@vocion/enterprise/index': 'libs/enterprise-none/index.ts',
    '@vocion/enterprise/client': 'libs/enterprise-none/client.ts',
    '@wsx/registry': 'libs/workspace/ext-stub/registry.tsx',
  };
  const resolveSpec = (from: string, spec: string): string | null => {
    let base: string;
    if (aliases[spec]) {
      base = join(srcDir, aliases[spec]);
    } else if (spec.startsWith('@/')) {
      base = join(srcDir, spec.slice(2));
    } else if (spec.startsWith('.')) {
      base = resolve(srcDir, from, '..', spec);
    } else {
      return null;
    }
    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      if (/\.(?:tsx?|m?js)$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile()) {
        return relative(srcDir, candidate);
      }
    }
    return null;
  };
  const cache = new Map<string, string[]>();
  return {
    edges(file) {
      const hit = cache.get(file);
      if (hit) {
        return hit;
      }
      const source = readFileSync(join(srcDir, file), 'utf8');
      const ignored = new Set([...source.matchAll(IGNORED_IMPORT)].map(m => m[1]));
      const output = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve, removeComments: true },
      }).outputText;
      // Static, re-export and dynamic imports, read by TypeScript itself.
      const out = new Set<string>();
      for (const { fileName: spec } of ts.preProcessFile(output, true, true).importedFiles) {
        if (ignored.has(spec)) {
          continue;
        }
        const target = resolveSpec(file, spec);
        if (target) {
          out.add(target);
        }
      }
      const edges = [...out];
      cache.set(file, edges);
      return edges;
    },
  };
}

/**
 * The path from one module to another, or null when it is not reachable.
 * @param graph - The import graph.
 * @param from - Where to start.
 * @param to - What to look for.
 */
export function pathBetween(graph: ModuleGraph, from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (file === to) {
      const chain: string[] = [];
      for (let at: string | null | undefined = file; at; at = prev.get(at)) {
        chain.unshift(at);
      }
      return chain;
    }
    for (const next of graph.edges(file)) {
      if (!prev.has(next)) {
        prev.set(next, file);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * How many modules a module reaches, itself included.
 * @param graph - The import graph.
 * @param from - Where to start.
 */
export function reachOf(graph: ModuleGraph, from: string): number {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    for (const next of graph.edges(stack.pop()!)) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size;
}

/**
 * Every route entry Next compiles, `src`-relative.
 * @param srcDir - Absolute path of `packages/core/src`.
 */
export function routeEntries(srcDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (ENTRY_FILE.test(entry.name)) {
        out.push(relative(srcDir, path));
      }
    }
  };
  walk(join(srcDir, 'app'));
  for (const file of ['proxy.ts', 'instrumentation.ts']) {
    if (existsSync(join(srcDir, file))) {
      out.push(file);
    }
  }
  return out.sort();
}

/**
 * CLI entrypoint: print what was found and return the process exit code.
 * @param srcDir - Absolute path of `packages/core/src`.
 */
export function runCheck(srcDir: string = resolve(fileURLToPath(import.meta.url), '../..')): number {
  const graph = moduleGraph(srcDir);
  const problems: string[] = [];
  for (const { from, to } of FORBIDDEN_REACH) {
    const chain = pathBetween(graph, from, to);
    if (chain) {
      problems.push(`${from} reaches ${to}, so every route that imports it compiles the whole server:\n  ${chain.join('\n  -> ')}\nCut an edge on that path (an event goes through libs/eventBridge.ts).`);
    }
  }
  const reaches = routeEntries(srcDir).map(entry => ({ entry, reach: reachOf(graph, entry) }));
  const total = reaches.reduce((sum, r) => sum + r.reach, 0);
  if (total > REACH_BUDGET) {
    const largest = [...reaches].sort((a, b) => b.reach - a.reach).slice(0, 5).map(r => `  ${r.reach}  ${r.entry}`).join('\n');
    problems.push(`The routes reach ${total} modules in all, over the budget of ${REACH_BUDGET}. Largest:\n${largest}\nLook for the edge that put a large graph under a widely imported module before raising REACH_BUDGET.`);
  }
  if (problems.length > 0) {
    process.stderr.write(`check:route-graph\n\n${problems.join('\n\n')}\n`);
    return 1;
  }
  process.stdout.write(`check:route-graph — ${reaches.length} routes reach ${total} modules in all (budget ${REACH_BUDGET}); libs/Auth.ts reaches ${reachOf(graph, 'libs/Auth.ts')}.\n`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exit(runCheck());
}
