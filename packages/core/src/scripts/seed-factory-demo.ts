#!/usr/bin/env tsx
/**
 * Stand a software-factory workspace up with a queue somebody can read.
 *
 * `file-requests.ts` is the intake door and is deliberately narrow: it files
 * work that has just arrived, so everything it writes starts at `new`. That
 * is right for real work and useless for looking at the product, because the
 * pages worth reviewing — Work's three lanes, Performance's four figures,
 * Releases' outcomes — only say anything when the queue has a history.
 *
 * This writes that history. It is a DEMO seeder, not an importer: it takes a
 * fixture at face value, metadata and all, so a fixture can place a row in
 * any state the state machine allows. That is exactly why it refuses to
 * write over a record it did not create (`demoSeed: true`) — a script that
 * can set any field must not be able to quietly rewrite real work.
 *
 * The fixtures are fictional and live with the sample workspace that uses
 * them (`templates/workspaces/engineering-team/data/factory/`), because a
 * fixture is a concretion: the MECHANISM is here, the CAST is not.
 *
 *   tsx src/scripts/seed-factory-demo.ts --project <orgId> --dir <path>
 *   tsx src/scripts/seed-factory-demo.ts --project <orgId> --dir <path> --apply
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

type Fixture = { dedupeKey: string; title: string; [k: string]: unknown };

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? null : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

/** Read one fixture file, tolerating an absent one so a workspace can seed only what it has. */
function read(dir: string, name: string): Fixture[] {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      throw new TypeError(`${name} must be a JSON array`);
    }
    return parsed as Fixture[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

/**
 * Write one type's fixtures. Returns what it did so the caller can print a
 * single honest line per type rather than a running commentary.
 * @param opts
 * @param opts.project
 * @param opts.typeSlug
 * @param opts.rows
 * @param opts.apply
 */
async function seedType(opts: { project: string; typeSlug: string; rows: Fixture[]; apply: boolean }): Promise<string> {
  const { project, typeSlug, rows, apply } = opts;
  if (rows.length === 0) {
    return `${typeSlug.padEnd(10)} no fixture`;
  }

  const [type] = await db
    .select()
    .from(businessObjectTypeSchema)
    .where(and(eq(businessObjectTypeSchema.orgId, project), eq(businessObjectTypeSchema.slug, typeSlug)));
  if (!type) {
    return `${typeSlug.padEnd(10)} SKIPPED — no \`${typeSlug}\` object type on this project`;
  }

  const existing = await db
    .select()
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, project), eq(businessObjectSchema.typeId, type.id)));
  const byKey = new Map<string, typeof existing[number]>();
  for (const r of existing) {
    const meta = r.metadata as Record<string, unknown> | null;
    const key = meta?.dedupeKey;
    if (typeof key === 'string') {
      byKey.set(key, r);
    }
  }

  let created = 0;
  let updated = 0;
  let refused = 0;
  for (const row of rows) {
    const { dedupeKey, title, ...meta } = row;
    const prior = byKey.get(dedupeKey);
    // A record this script did not create is somebody's work. Refuse it —
    // silently overwriting is the failure mode a seeder must not have.
    if (prior && (prior.metadata as Record<string, unknown> | null)?.demoSeed !== true) {
      refused += 1;
      continue;
    }
    const metadata = { ...meta, dedupeKey, demoSeed: true };
    if (prior) {
      updated += 1;
      if (apply) {
        await db.update(businessObjectSchema).set({ title, metadata }).where(eq(businessObjectSchema.id, prior.id));
      }
    } else {
      created += 1;
      if (apply) {
        await db.insert(businessObjectSchema).values({ orgId: project, typeId: type.id, title, status: 'active', metadata });
      }
    }
  }
  const tail = refused > 0 ? `  refused=${refused} (not demo-seeded)` : '';
  return `${typeSlug.padEnd(10)} created=${created}  updated=${updated}${tail}`;
}

async function main(): Promise<void> {
  const project = arg('project');
  const dir = arg('dir');
  const apply = process.argv.includes('--apply');
  if (!project || !dir) {
    throw new Error('usage: --project <orgId> --dir <fixture dir> [--apply]');
  }

  const lines: string[] = [];
  lines.push(await seedType({ project, typeSlug: 'request', rows: read(dir, 'requests.json'), apply }));
  lines.push(await seedType({ project, typeSlug: 'release', rows: read(dir, 'releases.json'), apply }));

  console.log(`${apply ? 'seeding' : 'dry run'} ${dir} → ${project}`);
  for (const l of lines) {
    console.log(`  ${l}`);
  }
  if (!apply) {
    console.log('\nnothing written — re-run with --apply');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
