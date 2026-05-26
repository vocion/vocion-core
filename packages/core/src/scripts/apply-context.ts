import process from 'node:process';
import { parseArgs } from 'node:util';
import { applyContext, ContextValidationError, loadContext } from '@/libs/context';
import 'dotenv/config';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'org': { type: 'string' },
      'applied-by': { type: 'string' },
      'help': { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const contextPath = positionals[0] ?? process.env.CONTEXT_PATH ?? 'context/metacto';

  let loaded;
  try {
    loaded = loadContext(contextPath);
  } catch (err) {
    if (err instanceof ContextValidationError) {
      console.error(`\n✗ ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  console.log(`✓ loaded context from ${loaded.sourcePath}`);
  console.log(`  org: ${values.org ?? loaded.manifest.orgId}`);
  console.log(`  sha: ${loaded.sha}`);
  console.log(`  agents: ${loaded.agents.length}, skills: ${loaded.skills.length}, objectTypes: ${loaded.objectTypes.length}, workflows: ${loaded.workflows.length}, playbooks: ${loaded.playbooks.length}, learningSteps: ${loaded.learningSteps.length}, evalDatasets: ${loaded.evalDatasets.length}, sources: ${loaded.sources.length}`);
  console.log(`  files: ${loaded.fileCount}`);

  const result = await applyContext(loaded, {
    dryRun: values['dry-run'],
    orgId: values.org,
    appliedBy: values['applied-by'] ?? process.env.USER ?? 'cli',
  });

  console.log(`\n${result.dryRun ? '[dry-run] ' : ''}applied to org ${result.orgId}:`);
  for (const [kind, counts] of Object.entries(result.counts)) {
    console.log(`  ${kind.padEnd(12)} created=${counts.created}  updated=${counts.updated}  unchanged=${counts.unchanged}`);
  }

  if (result.errors.length > 0) {
    console.error('\nerrors:');
    for (const e of result.errors) {
      console.error(`  ${e.resource}/${e.slug}: ${e.message}`);
    }
    process.exit(1);
  }

  if (result.versionId) {
    console.log(`\nrecorded context_version #${result.versionId}`);
  }
  process.exit(0);
}

function printHelp(): void {
  console.log(`
apply-context — reconcile a git-backed context directory to the database.

usage: npx tsx src/scripts/apply-context.ts [path] [options]

positional:
  path                   context directory to apply (default: $CONTEXT_PATH or context/metacto)

options:
  --dry-run              validate and diff without writing
  --org <id>             override orgId from manifest
  --applied-by <name>    who triggered the apply (default: $USER)
  -h, --help             show this help

exit codes:
  0  success
  1  apply completed with errors
  2  validation failed (nothing applied)
`.trim());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
