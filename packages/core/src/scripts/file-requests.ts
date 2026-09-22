#!/usr/bin/env tsx
/**
 * File a batch of requests into a project's queue, idempotently.
 *
 * Work arrives from outside the product all the time — a competitor ships
 * something, a colleague's repo solves a problem we also have, a support
 * thread names the same gap twice. Until now that became a message someone
 * had to remember, and the factory's queue only knew about work the factory
 * itself had seen.
 *
 * This is the door for it. The MECHANISM is here because filing an outcome is
 * a core act; WHICH outcomes are filed is a concretion and lives in the
 * instance, as a JSON file the script is pointed at.
 *
 * Idempotent by `dedupeKey`: re-running files nothing new, so this can be a
 * step in an automation rather than a thing a person runs once and fears
 * running twice. An existing request is left exactly as it is — a human
 * edit is never overwritten by a re-run.
 *
 * Usage:
 *   tsx src/scripts/file-requests.ts --project <orgId> --file <path>
 *   tsx src/scripts/file-requests.ts --project <orgId> --file <path> --apply
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

/** One request as the file declares it. Everything but title/dedupeKey optional. */
type Incoming = {
  dedupeKey: string;
  title: string;
  body?: string;
  kind?: string;
  why?: string[];
  whyNote?: string;
  surface?: string;
  sizeClass?: string;
  product?: string;
  source?: string;
  evidence?: { urls?: string[] };
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? null : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

async function main() {
  const project = arg('project');
  const file = arg('file');
  const apply = process.argv.includes('--apply');
  if (!project || !file) {
    throw new Error('usage: --project <orgId> --file <path> [--apply]');
  }

  const incoming = JSON.parse(readFileSync(file, 'utf8')) as Incoming[];
  if (!Array.isArray(incoming)) {
    throw new TypeError('the file must be a JSON array of requests');
  }

  const [type] = await db.select().from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, project), eq(businessObjectTypeSchema.slug, 'request')));
  if (!type) {
    throw new Error(`no \`request\` object type on ${project}`);
  }

  const existing = await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, project), eq(businessObjectSchema.typeId, type.id)));
  const seen = new Set(
    existing
      .map(r => (r.metadata as Record<string, unknown> | null)?.dedupeKey)
      .filter((k): k is string => typeof k === 'string'),
  );
  // A request filed before dedupeKey existed is still a duplicate if the
  // title matches, and filing it twice is worse than skipping it once.
  const titles = new Set(existing.map(r => r.title.trim().toLowerCase()));

  const now = new Date().toISOString();
  const toFile = incoming.filter(r => !seen.has(r.dedupeKey) && !titles.has(r.title.trim().toLowerCase()));

  console.log(`file:     ${incoming.length} declared`);
  console.log(`existing: ${existing.length} requests on this project`);
  console.log(`skipping: ${incoming.length - toFile.length} already filed`);
  console.log(`filing:   ${toFile.length}`);
  for (const r of toFile) {
    console.log(`  · [${r.surface ?? 'unclassified'}] ${r.title.slice(0, 66)}`);
  }

  if (!apply) {
    console.log('\ndry run — nothing written. re-run with --apply');
    process.exit(0);
  }

  for (const r of toFile) {
    await db.insert(businessObjectSchema).values({
      orgId: project,
      typeId: type.id,
      title: r.title,
      status: 'active',
      metadata: {
        state: 'new',
        kind: r.kind ?? 'gap',
        askedAt: now,
        dedupeKey: r.dedupeKey,
        ...(r.body ? { body: r.body } : {}),
        ...(r.why ? { why: r.why } : {}),
        ...(r.whyNote ? { whyNote: r.whyNote } : {}),
        ...(r.surface ? { surface: r.surface } : {}),
        ...(r.sizeClass ? { sizeClass: r.sizeClass } : {}),
        ...(r.product ? { product: r.product } : {}),
        ...(r.source ? { source: r.source } : {}),
        ...(r.evidence ? { evidence: r.evidence } : {}),
      },
    });
  }
  console.log(`\nfiled ${toFile.length} requests`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
