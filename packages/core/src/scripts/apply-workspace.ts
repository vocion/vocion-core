import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { applyWorkspace, getWorkspacePath, loadWorkspace, WorkspaceValidationError } from '@/libs/workspace';
import { projectSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Resolve which org_id to apply under. The app aliases orgId → the active
 * project id, so workspace rows MUST land under a real project id — not the
 * manifest's placeholder orgId (which required a manual post-apply re-key).
 * Precedence:
 *   1. --project <id|slug>  → that project's id (explicit, for deploys)
 *   2. --org <id>           → raw override (back-compat / advanced)
 *   3. exactly one project  → auto-target it (local "just works", no re-key)
 *   4. otherwise            → manifest orgId (with a warning)
 * @param projectArg
 * @param orgArg
 * @param manifestOrgId
 */
async function resolveOrgId(projectArg: string | undefined, orgArg: string | undefined, manifestOrgId: string): Promise<string> {
  if (projectArg) {
    const [p] = await db
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(or(eq(projectSchema.id, projectArg), eq(projectSchema.slug, projectArg)))
      .limit(1);
    if (!p) {
      console.error(`\n✗ no project matches --project "${projectArg}" (by id or slug)\n`);
      process.exit(2);
    }
    return p.id;
  }
  if (orgArg) {
    return orgArg;
  }
  const projects = await db.select({ id: projectSchema.id, slug: projectSchema.slug }).from(projectSchema);
  if (projects.length === 1) {
    console.log(`  (auto-targeting the sole project: ${projects[0]!.slug} / ${projects[0]!.id})`);
    return projects[0]!.id;
  }
  console.warn(`  ⚠ ${projects.length} projects exist — applying under manifest orgId "${manifestOrgId}". Pass --project <id|slug> to target one (avoids a re-key).`);
  return manifestOrgId;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'org': { type: 'string' },
      'project': { type: 'string' },
      'applied-by': { type: 'string' },
      'help': { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const contextPath = positionals[0] ?? getWorkspacePath();
  if (!contextPath) {
    console.error('no workspace path given — pass one (npm run workspace:apply -- <path>) or set WORKSPACE_PATH.');
    console.error('to scaffold a new workspace: npm run workspace:scaffold -- <name>');
    process.exit(1);
  }

  let loaded;
  try {
    loaded = loadWorkspace(contextPath);
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
      console.error(`\n✗ ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const orgId = values['dry-run']
    ? (values.project ?? values.org ?? loaded.manifest.orgId)
    : await resolveOrgId(values.project, values.org, loaded.manifest.orgId);

  console.log(`✓ loaded context from ${loaded.sourcePath}`);
  console.log(`  org: ${orgId}`);
  console.log(`  sha: ${loaded.sha}`);
  console.log(`  agents: ${loaded.agents.length}, skills: ${loaded.skills.length}, objectTypes: ${loaded.objectTypes.length}, workflows: ${loaded.workflows.length}, playbooks: ${loaded.playbooks.length}, learningSteps: ${loaded.learningSteps.length}, evalDatasets: ${loaded.evalDatasets.length}, sources: ${loaded.sources.length}`);
  console.log(`  files: ${loaded.fileCount}`);

  const result = await applyWorkspace(loaded, {
    dryRun: values['dry-run'],
    orgId,
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
    console.log(`\nrecorded workspace_version #${result.versionId}`);
  }
  process.exit(0);
}

function printHelp(): void {
  console.log(`
apply-workspace — reconcile a git-backed workspace directory to the database.

usage: npx tsx src/scripts/apply-workspace.ts [path] [options]

positional:
  path                   workspace directory to apply (default: $WORKSPACE_PATH; required if unset —
                         scaffold one with \`npm run workspace:scaffold -- <name>\`)

options:
  --dry-run              validate and diff without writing
  --project <id|slug>    apply under this project's id (recommended — no re-key).
                         Defaults to the sole project when exactly one exists.
  --org <id>             raw orgId override (advanced / back-compat)
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
