import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { applyWorkspace, getWorkspacePath, loadWorkspace, WorkspaceTemplateError, WorkspaceValidationError } from '@/libs/workspace';
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
    if (err instanceof WorkspaceValidationError || err instanceof WorkspaceTemplateError) {
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
  console.log(`  agents: ${loaded.agents.length}, teams: ${loaded.teams.length}, skills: ${loaded.skills.length}, objectTypes: ${loaded.objectTypes.length}, workflows: ${loaded.workflows.length}, playbooks: ${loaded.playbooks.length}, learningSteps: ${loaded.learningSteps.length}, evalDatasets: ${loaded.evalDatasets.length}, sources: ${loaded.sources.length}`);
  console.log(`  voice rules: ${loaded.voice ? `${loaded.voice.never.length} never, ${loaded.voice.prefer.length} prefer` : 'none authored (platform floor only)'}`);
  console.log(`  files: ${loaded.fileCount}`);

  const result = await applyWorkspace(loaded, {
    dryRun: values['dry-run'],
    orgId,
    appliedBy: values['applied-by'] ?? process.env.USER ?? 'cli',
  });

  console.log(`\n${result.dryRun ? '[dry-run] would apply' : 'applied'} to org ${result.orgId}:`);
  if (!result.database.reachable) {
    // Not a failure: a dry-run validates and reports without a database. The
    // summary says what it could not learn, and the exit code stays 0.
    console.log(`  (no database answered at DATABASE_URL — ${result.database.reason}.`);
    console.log('   manifests validated; created/updated/unchanged are unknown and accountableUser emails were not resolved.)');
  }
  for (const [kind, counts] of Object.entries(result.counts)) {
    const unknown = counts.unknown === undefined ? '' : `  unknown=${counts.unknown}`;
    console.log(`  ${kind.padEnd(12)} created=${counts.created}  updated=${counts.updated}  unchanged=${counts.unchanged}${unknown}`);
  }

  if (result.warnings.length > 0) {
    console.warn('\nwarnings:');
    for (const w of result.warnings) {
      console.warn(`  ${w.resource}/${w.slug}: ${w.message}`);
    }
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
  --dry-run              validate and diff without writing. Needs no database: with none
                         reachable it still validates and reports what it would apply,
                         with created/updated left unknown.
  --project <id|slug>    apply under this project's id (recommended — no re-key).
                         Defaults to the sole project when exactly one exists.
  --org <id>             raw orgId override (advanced / back-compat)
  --applied-by <name>    who triggered the apply (default: $USER)
  -h, --help             show this help

exit codes:
  0  success — warnings only, or a dry-run with no database, still exit 0
  1  apply completed with errors
  2  validation failed (nothing applied)
`.trim());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
