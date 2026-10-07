#!/usr/bin/env tsx
/**
 * fail-last-sync — records a failed last run on one source, through the same
 * `beginSync` and `finishSync` a real sync uses, so the row is shaped exactly
 * like one. The connect spec uses it to check what the Connectors row offers
 * after a sync that ended on a refused login, without calling a real vendor.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/connect/support/fail-last-sync.ts <sourceId> <error>
 */
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';
import { beginSync, finishSync } from '@/services/SourceSyncService';
import 'dotenv/config';

async function main(): Promise<void> {
  const [sourceIdArgument, error] = process.argv.slice(2);
  const sourceId = Number(sourceIdArgument);
  if (!Number.isInteger(sourceId) || !error) {
    throw new Error('Usage: fail-last-sync.ts <sourceId> <error>');
  }
  const [source] = await db
    .select({ orgId: knowledgeSourceSchema.orgId })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.id, sourceId))
    .limit(1);
  if (!source) {
    throw new Error(`No source with id ${sourceId}.`);
  }
  await beginSync(sourceId, source.orgId, false);
  await finishSync(sourceId, source.orgId, { status: 'failed', error });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fail-last-sync] failed:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
