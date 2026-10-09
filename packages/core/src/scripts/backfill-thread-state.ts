#!/usr/bin/env tsx
/**
 * Thread state for Gmail mail synced before thread state existed
 * (`services/mail/threadLabeller.ts`): for each Gmail source, the threads with
 * mail in the last N days are read by headers, labelled where the headers
 * cannot settle them, and filed. Idempotent and resumable: a thread already
 * labelled on its last message is skipped at no cost, so a re-run picks up
 * where an interrupted one stopped.
 *
 * Dry run by default: it lists each source's threads and prints the most the
 * labels can cost, reading no thread and calling no model.
 *
 * Usage:
 *   npm run mail:backfill-thread-state                                   # every Gmail source, dry run
 *   npm run mail:backfill-thread-state -- --project <orgId> --days 30    # one workspace
 *   npm run mail:backfill-thread-state -- --apply                        # run it here, throttled, with progress
 *   npm run mail:backfill-thread-state -- --apply --job                  # start it as a durable job per source
 *   npm run mail:backfill-thread-state -- --relabel                      # price relabelling under the current prompt (LABEL_VERSION)
 *   npm run mail:backfill-thread-state -- --relabel --apply --job        # relabel: only ever on purpose, never on a deploy
 */
import process from 'node:process';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';
import { planThreadStateBackfill, runThreadStateBackfill } from '@/services/mail/threadLabeller';

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const orgId = arg('--project');
  const windowDays = Number(arg('--days') ?? 30);
  const apply = argv.includes('--apply');
  const asJob = argv.includes('--job');
  const relabel = argv.includes('--relabel');
  const sources = await db
    .select({ id: knowledgeSourceSchema.id, orgId: knowledgeSourceSchema.orgId, slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .where(and(
      or(eq(knowledgeSourceSchema.slug, 'gmail'), sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'gmail'`),
      ...(orgId ? [eq(knowledgeSourceSchema.orgId, orgId)] : []),
    ));
  let totalThreads = 0;
  let totalCents = 0;
  for (const s of sources) {
    const plan = await planThreadStateBackfill({ orgId: s.orgId, sourceId: s.id, windowDays, relabel }).catch((error: unknown) => {
      console.log(JSON.stringify({ source: s.slug, orgId: s.orgId, skipped: error instanceof Error ? error.message : String(error) }));
      return null;
    });
    if (!plan) {
      continue;
    }
    totalThreads += plan.threadIds.length;
    totalCents += plan.maxCents;
    console.log(JSON.stringify({ source: plan.sourceSlug, sourceId: plan.sourceId, orgId: plan.orgId, windowDays, threads: plan.threadIds.length, alreadyLabelled: plan.alreadyLabelled, maxLabels: plan.maxLabels, maxUsd: (plan.maxCents / 100).toFixed(2) }));
    if (!apply || plan.threadIds.length === 0) {
      continue;
    }
    if (asJob) {
      const { startJob } = await import('@/libs/durable/jobs');
      const { JOB } = await import('@/services/background/catalog');
      const started = await startJob(`thread-state-${relabel ? 'relabel' : 'backfill'}-${plan.sourceId}-${new Date().toISOString().slice(0, 10)}`, { job: JOB.mailThreadStateBackfill, input: { orgId: plan.orgId, sourceId: plan.sourceId, windowDays, relabel } });
      console.log(JSON.stringify({ started: started.id }));
    } else {
      const done = await runThreadStateBackfill(plan, { log: line => console.log(line) });
      console.log(JSON.stringify({ source: plan.sourceSlug, orgId: plan.orgId, ...done, usd: (done.labelled * 0.0008).toFixed(2) }));
    }
  }
  console.log(JSON.stringify({ mode: apply ? (asJob ? 'job' : 'apply') : 'dry-run', relabel, sources: sources.length, threads: totalThreads, maxUsd: (totalCents / 100).toFixed(2) }));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
