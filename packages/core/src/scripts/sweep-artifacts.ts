/**
 * sweep-artifacts — report the rendered files superseded document versions
 * left behind, and reclaim them only when told to.
 *
 * Every render-verify writes a PNG per sheet and a PDF into the artifact
 * store (`VOCION_ARTIFACTS_DIR`, default `<cwd>/.artifacts`). Nothing has ever
 * removed one, so a proposal edited twenty times leaves twenty sets on disk
 * and the box grows for the life of the deployment.
 *
 * **It reports. It does not delete.** Deleting a person's rendered
 * deliverable is destructive and irreversible — the bytes are the only copy —
 * so the default run prints exactly what it would remove and what that would
 * reclaim, and `--apply` is the only way to make it act. It is not wired to
 * any schedule: someone runs it, reads it, and decides.
 *
 * usage:
 *   npm run artifacts:sweep                      # every workspace, report only
 *   npm run artifacts:sweep -- --org org_123     # one workspace
 *   npm run artifacts:sweep -- --keep 10         # keep 10 superseded versions
 *   npm run artifacts:sweep -- --apply           # actually remove them
 *
 * What it will never remove is in `libs/tools/artifacts/sweep.ts`: a file a
 * current version holds, a file one of the newest `--keep` superseded
 * versions holds, a file any surviving version anywhere in the workspace
 * still names (the store is content-addressed, so versions share files), and
 * anything no version ever referenced — a `generate_image` PNG lives in a
 * message's prose and no row points at it, so this sweep has no business
 * judging it.
 */

import type { SweepVersion } from '@/libs/tools/artifacts/sweep';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactsDir } from '@/libs/tools/artifacts/store';
import { filesInSpec, planArtifactSweep } from '@/libs/tools/artifacts/sweep';
import { artifactSchema, artifactVersionSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * How many superseded versions keep their files by default.
 *
 * Restoring an old version writes a new head carrying its content, so recent
 * history has to stay openable rather than merely listable. Five is a working
 * guess, not a measured one — say so rather than dress it up.
 */
const DEFAULT_KEEP = 5;

type OrgReport = {
  orgId: string;
  artifacts: number;
  versions: number;
  keptCurrent: number;
  keptRecent: number;
  keptShared: number;
  files: Array<{ filename: string; artifactId: number; version: number; bytes: number | null }>;
};

/**
 * Every version of every artifact in one workspace, reduced to what the plan
 * needs. No limit: a truncated history means a live file looks orphaned.
 * @param orgId - The workspace.
 */
async function versionsFor(orgId: string): Promise<{ versions: SweepVersion[]; artifacts: number }> {
  const rows = await db
    .select({
      artifactId: artifactVersionSchema.artifactId,
      version: artifactVersionSchema.version,
      spec: artifactVersionSchema.spec,
      currentVersion: artifactSchema.currentVersion,
      rowUrl: artifactSchema.url,
    })
    .from(artifactVersionSchema)
    .innerJoin(artifactSchema, eq(artifactVersionSchema.artifactId, artifactSchema.id))
    .where(eq(artifactVersionSchema.orgId, orgId));

  const artifacts = new Set(rows.map(r => r.artifactId));
  const versions = rows.map(r => ({
    artifactId: r.artifactId,
    version: r.version,
    current: r.version === r.currentVersion,
    // The row URL rides with the head version only: it is the artifact's
    // current file, not a fact about an old version.
    files: filesInSpec(r.spec, r.version === r.currentVersion ? r.rowUrl : null),
  }));
  return { versions, artifacts: artifacts.size };
}

/**
 * Plan one workspace and measure what the plan would reclaim.
 * @param orgId - The workspace.
 * @param keep - How many superseded versions keep their files.
 * @param dir - The artifact store directory.
 */
async function reportFor(orgId: string, keep: number, dir: string): Promise<OrgReport> {
  const { versions, artifacts } = await versionsFor(orgId);
  const plan = planArtifactSweep(versions, { keepSuperseded: keep });
  const files = await Promise.all(plan.removable.map(async (c) => {
    const bytes = await stat(path.join(dir, c.filename)).then(s => s.size, () => null);
    return { ...c, bytes };
  }));
  return { orgId, artifacts, versions: versions.length, keptCurrent: plan.keptCurrent, keptRecent: plan.keptRecent, keptShared: plan.keptShared, files };
}

function human(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printHelp(): void {
  console.log(`
sweep-artifacts — report (and only on request, reclaim) the rendered files
that superseded document versions left in the artifact store.

usage: npx tsx src/scripts/sweep-artifacts.ts [options]

  --org <id>     One workspace. Default: every workspace with artifacts.
  --keep <n>     Superseded versions per artifact that keep their files.
                 Default ${DEFAULT_KEEP}.
  --apply        Actually delete. WITHOUT THIS THE SCRIPT ONLY REPORTS.
  --quiet        Summary lines only; do not list every file.
  -h, --help     This.

Never removed: a current version's files, the newest --keep superseded
versions' files, any file a surviving version anywhere in the workspace still
names (the store is content-addressed, so versions share files), and any file
no version ever referenced.
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      org: { type: 'string' },
      keep: { type: 'string' },
      apply: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    printHelp();
    return 0;
  }
  const keep = values.keep === undefined ? DEFAULT_KEEP : Number(values.keep);
  if (!Number.isFinite(keep) || keep < 0) {
    console.error(`--keep must be a number ≥ 0, got ${values.keep}`);
    return 2;
  }
  const dir = artifactsDir();
  const orgIds = values.org
    ? [values.org]
    : (await db.selectDistinct({ orgId: artifactSchema.orgId }).from(artifactSchema)).map(r => r.orgId);

  const reports: OrgReport[] = [];
  for (const orgId of orgIds) {
    reports.push(await reportFor(orgId, keep, dir));
  }

  const apply = values.apply === true;
  const prefix = apply ? '' : '[dry-run] ';
  console.log(`${prefix}sweep-artifacts — store ${dir}, keeping the newest ${keep} superseded version${keep === 1 ? '' : 's'} per artifact`);

  let totalFiles = 0;
  let totalBytes = 0;
  let missing = 0;
  let failed = 0;
  for (const r of reports) {
    const bytes = r.files.reduce((n, f) => n + (f.bytes ?? 0), 0);
    const gone = r.files.filter(f => f.bytes === null).length;
    totalFiles += r.files.length - gone;
    totalBytes += bytes;
    missing += gone;
    console.log(`${prefix}  ${r.orgId}: ${r.artifacts} artifacts · ${r.versions} versions · ${r.files.length} removable (${human(bytes)})${gone > 0 ? ` · ${gone} already gone from disk` : ''}`);
    console.log(`${prefix}    kept: ${r.keptCurrent} on current versions · ${r.keptRecent} on recent history · ${r.keptShared} shared with a surviving version`);
    if (!values.quiet) {
      for (const f of r.files) {
        console.log(`${prefix}    ${apply ? 'delete' : 'would delete'} ${f.filename}  (artifact #${f.artifactId} v${f.version}, ${f.bytes === null ? 'not on disk' : human(f.bytes)})`);
      }
    }
    if (apply) {
      for (const f of r.files) {
        if (f.bytes === null) {
          continue;
        }
        try {
          await unlink(path.join(dir, f.filename));
        } catch (err) {
          failed += 1;
          console.error(`    could not delete ${f.filename}: ${(err as Error).message}`);
        }
      }
    }
  }

  console.log(`${prefix}${apply ? 'deleted' : 'would delete'} ${totalFiles} file${totalFiles === 1 ? '' : 's'}, ${human(totalBytes)} reclaimed${missing > 0 ? ` (${missing} already gone)` : ''}${failed > 0 ? ` · ${failed} failed` : ''}`);
  if (!apply) {
    console.log('Nothing was deleted. Re-run with --apply once you have read the list above.');
  }
  return failed > 0 ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) {
  main().then(code => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
