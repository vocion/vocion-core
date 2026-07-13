/**
 * scaffold-workspace — create a new git-backed workspace directory.
 *
 * Workspaces live OUTSIDE the vocion-core repo, at the peer level of the
 * checkout. When vocion-core is a submodule of a deployment repo
 * (`<deployment>/vocion-core/`), the default destination lands in that
 * repo's `workspace/` directory beside the submodule:
 *
 *   <deployment>/
 *   ├── vocion-core/          ← this repo
 *   └── workspace/
 *       └── <name>/           ← created here
 *
 * usage: npm run workspace:scaffold -- <name> [--path <dir>]
 *
 * After scaffolding, point the app at it (WORKSPACE_PATH=<dir>) and apply
 * with `npm run workspace:apply -- <dir> --project <id|slug>`.
 *
 * Thin CLI wrapper — the filesystem logic lives in
 * `@/libs/workspace/scaffold` so it stays unit-testable.
 */
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { getRepoRoot } from '@/libs/repo-root';
import { scaffoldWorkspace } from '@/libs/workspace/scaffold';

function printHelp(): void {
  console.log(`
scaffold-workspace — create a new git-backed workspace directory.

usage: npm run workspace:scaffold -- <name> [options]

positional:
  name                 workspace name (lowercase, digits, dashes; e.g. acme-revenue)

options:
  --path <dir>         destination directory (default: ../workspace/<name>,
                       the peer level of this checkout)
  -h, --help           show this help

The scaffold is minimal-but-valid: \`workspace:check\` passes on it as-is.
Next steps are printed after creation.
`);
}

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      path: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const name = positionals[0];
  if (!name) {
    console.error('missing workspace name. usage: npm run workspace:scaffold -- <name>');
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  const dest = values.path
    ? resolve(process.cwd(), values.path)
    : resolve(repoRoot, '..', 'workspace', name);

  // The apply path shown in instructions: relative to cwd when it's short,
  // absolute otherwise.
  const rel = relative(process.cwd(), dest);
  const applyPath = rel.startsWith('..') && rel.split('/').length > 4 ? dest : rel;

  try {
    scaffoldWorkspace({ name, dest, applyPath });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`✓ scaffolded workspace at ${dest}`);
  console.log(`
next steps:
  1. author your first agent in ${join(applyPath, 'agents')}/ (example in the workspace README)
  2. validate:  npm run workspace:check -- ${applyPath}
  3. apply:     npm run workspace:apply -- ${applyPath} --project <id|slug>
  4. for the running app, set WORKSPACE_PATH=${applyPath}
`);
}

main();
