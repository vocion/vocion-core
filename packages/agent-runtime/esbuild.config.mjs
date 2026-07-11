/**
 * Bundle the runtime into a self-contained dist/index.js for the
 * AgentCore Runtime CodeZip. Node built-ins stay external; everything
 * else (deepagents, langchain, langfuse) is inlined.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // ESM bundles need a require shim for transitive CJS deps.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: 'info',
});
