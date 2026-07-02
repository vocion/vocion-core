#!/usr/bin/env tsx
/**
 * Run a source sync from the CLI — the ops path for backfills and headless
 * installs (the Sources UI "Sync now" is the in-app equivalent).
 *
 * Usage:
 *   npm run sync:source -- --project <id|slug> --source <slug> [--full]
 *   npm run sync:source -- --project metacto --source hubspot-contacts
 *
 * Incremental by default (uses the last checkpoint); --full re-fetches
 * everything (still content-hash deduped, so unchanged docs are no-ops).
 */
import process from 'node:process';
import { and, eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema, projectSchema } from '@/models/Schema';
import { runSync } from '@/services/SourceSyncService';

function parseArgs(argv: string[]) {
  const out: { project?: string; source?: string; full?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--project') {
      out.project = argv[++i];
    } else if (a === '--source') {
      out.source = argv[++i];
    } else if (a === '--full') {
      out.full = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.source) {
    console.error('Usage: sync-source --project <id|slug> --source <slug> [--full]');
    process.exit(1);
  }
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, args.project), eq(projectSchema.slug, args.project)))
    .limit(1);
  if (!project) {
    console.error(`No project matches "${args.project}".`);
    process.exit(1);
  }
  const [source] = await db
    .select({ id: knowledgeSourceSchema.id })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, project.id), eq(knowledgeSourceSchema.slug, args.source)))
    .limit(1);
  if (!source) {
    console.error(`No source "${args.source}" in project ${project.id}.`);
    process.exit(1);
  }

  let fetched = 0;
  const started = Date.now();
  const timer = setInterval(() => {
    console.log(`  …${fetched} records fetched (${Math.round((Date.now() - started) / 1000)}s)`);
  }, 15_000);
  try {
    const result = await runSync({
      orgId: project.id,
      sourceId: source.id,
      incremental: !args.full,
      onProgress: (e) => {
        if (e.kind === 'fetched') {
          fetched += 1;
        } else if (e.kind === 'error') {
          console.error(`  error: ${e.uri ?? ''} ${e.message ?? ''}`);
        }
      },
    });
    clearInterval(timer);
    console.log(`✓ ${args.source}: created=${result.created} updated=${result.updated} unchanged=${result.unchanged} tombstoned=${result.tombstoned} errors=${result.errors} (${Math.round((Date.now() - started) / 1000)}s)`);
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (err) {
    clearInterval(timer);
    console.error(`✗ ${args.source}: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
