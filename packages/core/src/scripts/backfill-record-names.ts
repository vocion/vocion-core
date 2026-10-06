#!/usr/bin/env tsx
/**
 * Name the records whose title is the whole ask (Chris, 2026-10-03: "we need
 * a better ticket-sized name for what the feature is; not a full request or
 * spec in the title").
 *
 * Requests filed before titles were ticket-sized carry the person's whole
 * sentence as their title. This reads each title longer than the type's limit
 * (its title's `maxLength`, else `NAME_MAX`) into a name with the same model
 * read the filing tool uses (`services/objects/recordName.ts`) and keeps it on
 * `metadata.name`, which every surface reads before the title
 * (`libs/workspace/recordName.ts`). The title itself is never edited: it is
 * the record's history.
 *
 * ADDITIVE: a record that already has a name is skipped, so a re-run is a
 * no-op and a person's own name is never replaced. The share page names a
 * record the first time it is read anyway; this does the rest at once.
 *
 * Usage (on the box, inside the app container):
 *   tsx src/scripts/backfill-record-names.ts --project <orgId>                 # dry run
 *   tsx src/scripts/backfill-record-names.ts --project <orgId> --apply
 *   tsx src/scripts/backfill-record-names.ts --project <orgId> --type <slug> --limit 50 --apply
 * Without --type it names the software factory's request type.
 */
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { factoryTypes } from '@/libs/factory/types';
import { NAME_MAX, wantsName } from '@/libs/workspace/recordName';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { keepRecordName, readRecordName } from '@/services/objects/recordName';

function arg(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const project = arg(argv, '--project');
  const apply = argv.includes('--apply');
  const limit = Number(arg(argv, '--limit') ?? Infinity);
  if (!project) {
    throw new Error('usage: --project <orgId> [--type <slug>] [--limit <n>] [--apply]');
  }
  const slug = arg(argv, '--type') ?? (await factoryTypes(project)).request;
  const [type] = await db.select().from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, project), eq(businessObjectTypeSchema.slug, slug)));
  if (!type) {
    throw new Error(`no \`${slug}\` object type on ${project}`);
  }
  const titleProp = ((type.schema as Record<string, unknown> | null)?.properties as Record<string, Record<string, unknown>> | undefined)?.title;
  const max = typeof titleProp?.maxLength === 'number' ? titleProp.maxLength : NAME_MAX;

  const rows = await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, project), eq(businessObjectSchema.typeId, type.id)));
  const todo = rows.filter(r => wantsName(r.title, (r.metadata ?? {}) as Record<string, unknown>, max)).slice(0, limit);
  console.log(`${slug}: ${rows.length} records, ${todo.length} with a title over ${max} characters and no name`);

  let named = 0;
  let failed = 0;
  for (const r of todo) {
    const name = await readRecordName({ orgId: project, text: r.title, kind: type.label.toLowerCase() });
    if (!name) {
      failed += 1;
      console.log(`  #${r.id} could not be named — ${r.title.slice(0, 70)}…`);
      continue;
    }
    console.log(`  #${r.id} ${name}  ←  ${r.title.slice(0, 70)}…`);
    if (apply) {
      await keepRecordName(project, r.id, name);
    }
    named += 1;
  }
  console.log(apply ? `\napplied: ${named} named, ${failed} not` : `\ndry run — ${named} names read, nothing written (${failed} failed). Re-run with --apply.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
