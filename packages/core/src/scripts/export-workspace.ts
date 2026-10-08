import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { zipWorkspace } from '@/libs/workspace/archive';
import { projectSchema } from '@/models/Schema';
import { exportWorkspace } from '@/services/workspace/WorkspaceExportService';
import 'dotenv/config';

/**
 * Export a workspace from the database as a folder of workspace files (or a
 * zip), every kind the loader reads — the same export an admin downloads from
 * Workforce › Settings › Context (`services/workspace/WorkspaceExportService.ts`).
 * The folder applies anywhere with `workspace:apply`; `EXPORT.md` in it says
 * which files are as authored and which were written from what is running.
 *
 * usage: npm run workspace:export -- --project <id|slug> [--out <folder>] [--zip <file.zip>]
 *
 * `--org <id>` is read as `--project`; `--name <dir>` writes to
 * `<--out, default context>/<dir>`, as this script always has.
 */

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      org: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      zip: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log('usage: npm run workspace:export -- --project <id|slug> [--out <folder>] [--zip <file.zip>]');
    process.exit(0);
  }
  const wanted = values.project ?? values.org ?? process.env.SEED_ORG_ID;
  const project = await resolveProject(wanted);
  const exported = await exportWorkspace(project.id);

  if (values.zip) {
    const file = resolve(values.zip);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, zipWorkspace(exported.files, `${exported.project.slug}-workspace`));
    console.log(`\n✓ exported ${exported.project.slug} to ${file}`);
  } else {
    const dir = values.name
      ? join(process.cwd(), values.out ?? 'context', values.name)
      : resolve(values.out ?? `${exported.project.slug}-workspace`);
    for (const f of exported.files) {
      const abs = join(dir, ...f.path.split('/'));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content);
    }
    console.log(`\n✓ exported ${exported.project.slug} to ${dir}`);
  }
  console.log(`  files: ${exported.files.length} (started from: ${exported.report.base})`);
  for (const r of exported.report.fromRows) {
    console.log(`  from what is running: ${r.kind} ${r.slug} (${r.why})`);
  }
  for (const l of exported.report.left) {
    console.warn(`  ⚠ not exported: ${l.kind} ${l.slug} — ${l.reason}`);
  }
  for (const p of exported.report.problems) {
    console.warn(`  ⚠ ${p}`);
  }
  process.exit(0);
}

/**
 * The project to export, by id or slug; the only project when none is named.
 * @param wanted - An id or slug, or nothing.
 */
async function resolveProject(wanted: string | undefined): Promise<{ id: string; slug: string }> {
  if (wanted) {
    const [p] = await db
      .select({ id: projectSchema.id, slug: projectSchema.slug })
      .from(projectSchema)
      .where(or(eq(projectSchema.id, wanted), eq(projectSchema.slug, wanted)))
      .limit(1);
    if (!p) {
      console.error(`\n✗ no project matches "${wanted}" (by id or slug)\n`);
      process.exit(2);
    }
    return p;
  }
  const projects = await db.select({ id: projectSchema.id, slug: projectSchema.slug }).from(projectSchema);
  if (projects.length !== 1) {
    console.error(`\n✗ ${projects.length} projects exist — pass --project <id|slug>\n`);
    process.exit(2);
  }
  return projects[0]!;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
