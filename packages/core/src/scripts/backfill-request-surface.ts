#!/usr/bin/env tsx
/**
 * Backfill `request.surface` from the diff the work actually produced.
 *
 * `surface` decides whether an outcome owes a picture (`libs/workspace/
 * workQueue.ts`, `visualGap`). Nothing set it before it existed, so the queue
 * can ask for a mockup of nothing and an after-shot of nothing until the
 * records say which changes a person can look at.
 *
 * ADDITIVE, and deliberately so. The first plan was to delete each request
 * and re-file it through intake; that throws away the created date, the
 * decision history, the accumulated cost and the `shippedAt` stamp that Done
 * and Activity read, and it re-issues ids that existing links and citations
 * point at. This writes one field and touches nothing else: a request whose
 * `surface` is already set is left exactly as it is, so a re-run is a no-op
 * and a human correction is never overwritten.
 *
 * DETERMINISTIC, and deliberately so. It asks no model. `engineering_task.
 * filesChanged` is the diff the work produced, so "did this change something
 * a person looks at" is answerable by reading paths — evidence, not a guess.
 * Where there is no diff to read (nothing built yet) it writes nothing rather
 * than inventing a classification; that outcome stays unclassified, claims no
 * gap, and waits for triage or for the work to ship.
 *
 * Usage:
 *   tsx src/scripts/backfill-request-surface.ts --project <orgId>            # dry run
 *   tsx src/scripts/backfill-request-surface.ts --project <orgId> --apply
 */
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

/** Paths that render something a person looks at. */
const VISUAL_PATH = [
  /(^|\/)src\/app\//,
  /(^|\/)src\/features\//,
  /(^|\/)src\/components\//,
  /\.tsx$/,
  /\.css$/,
  // A page manifest IS the page: it declares what the reader sees.
  /templates\/.*\/pages\/.*\.(ya?ml|md)$/,
];

function touchesVisual(paths: string[]): boolean {
  return paths.some(p => VISUAL_PATH.some(re => re.test(p)));
}

function filesOf(meta: Record<string, unknown>): string[] {
  const v = meta.filesChanged;
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : [];
}

async function typeIdFor(orgId: string, slug: string): Promise<number | null> {
  const [t] = await db.select().from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, slug)));
  return t?.id ?? null;
}

async function main() {
  const argv = process.argv.slice(2);
  const project = argv[argv.indexOf('--project') + 1];
  const apply = argv.includes('--apply');
  if (!project || project.startsWith('--')) {
    throw new Error('usage: --project <orgId> [--apply]');
  }

  const requestType = await typeIdFor(project, 'request');
  const taskType = await typeIdFor(project, 'engineering_task');
  if (requestType === null) {
    throw new Error(`no \`request\` object type on ${project}`);
  }

  const requests = await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, project), eq(businessObjectSchema.typeId, requestType)));
  const tasks = taskType === null
    ? []
    : await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, project), eq(businessObjectSchema.typeId, taskType)));

  // Tasks by the request they belong to, so each request reads its own diff.
  const byRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const t of tasks) {
    const m = (t.metadata ?? {}) as Record<string, unknown>;
    const key = m.requestId;
    if (typeof key === 'string' || typeof key === 'number') {
      const k = String(key);
      byRequest.set(k, [...(byRequest.get(k) ?? []), m]);
    }
  }

  const plan: Array<{ id: number; title: string; surface: string; why: string }> = [];
  let alreadySet = 0;
  let noEvidence = 0;

  for (const r of requests) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.surface === 'string' && meta.surface.trim() !== '') {
      alreadySet += 1;
      continue;
    }
    const mine = byRequest.get(String(r.id)) ?? [];
    const withDiff = mine.filter(m => filesOf(m).length > 0);
    if (withDiff.length === 0) {
      noEvidence += 1;
      continue;
    }
    const all = withDiff.flatMap(m => filesOf(m));
    const visual = touchesVisual(all);
    plan.push({
      id: r.id,
      title: r.title,
      surface: visual ? 'ui' : 'none',
      why: visual
        ? `touched ${all.filter(p => VISUAL_PATH.some(re => re.test(p))).slice(0, 2).join(', ')}`
        : `${all.length} files, none user-facing`,
    });
  }

  console.log(`requests: ${requests.length}  tasks: ${tasks.length}`);
  console.log(`  already classified: ${alreadySet}`);
  console.log(`  no diff to read (left unset): ${noEvidence}`);
  console.log(`  would set: ${plan.length}`);
  for (const p of plan) {
    console.log(`    [${p.surface}] #${p.id} ${p.title.slice(0, 58)} — ${p.why}`);
  }

  if (!apply) {
    console.log('\ndry run — nothing written. re-run with --apply');
    process.exit(0);
  }

  for (const p of plan) {
    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, p.id));
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    // Re-read and re-check: never overwrite a value set between plan and write.
    if (typeof meta.surface === 'string' && meta.surface.trim() !== '') {
      continue;
    }
    await db.update(businessObjectSchema)
      .set({ metadata: { ...meta, surface: p.surface } })
      .where(eq(businessObjectSchema.id, p.id));
  }
  console.log(`\napplied: ${plan.length} requests classified`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
