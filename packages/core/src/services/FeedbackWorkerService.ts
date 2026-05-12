/**
 * FeedbackWorkerService — Phase 6.
 *
 * Long-lived poll loop that drains `feedback_job` rows queued by
 * webhooks (Drive comments, Slack reactions, etc.) and manual UI
 * feedback. At-least-once delivery via Postgres `FOR UPDATE
 * SKIP LOCKED`. Each job is classified via the Haiku classifier;
 * the resulting bucket is stored back on the row.
 *
 * The worker DOES NOT auto-commit learnings — that's the
 * self-improver subagent's job, gated by user approval in the chat
 * UI. The worker's role is to triage and queue.
 *
 * Architecture: Next.js / Vercel cannot host this loop. Ship as a
 * separate process via `npm run worker:serve` (entry:
 * scripts/worker-serve.ts). Opt-in via ENABLE_FEEDBACK_WORKER=1.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { feedbackJobSchema } from '@/models/Schema';
import { classifyComment } from './feedback/classifier';

export type FeedbackPayload = {
  /** Free-form text the user wrote. */
  text: string;
  /** Optional text the user was reacting to. */
  quotedText?: string;
  /** Artifact title for context. */
  artifactTitle?: string;
  /** Which artifact/operation/run this feedback targets. */
  targetSlug?: string;
};

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

export async function enqueue(opts: {
  orgId: string;
  source: 'drive' | 'slack' | 'onyx' | 'manual';
  externalId: string;
  payload: FeedbackPayload;
}) {
  // Idempotency: skip if we already have this (source, externalId).
  const existing = await db
    .select()
    .from(feedbackJobSchema)
    .where(
      sql`${feedbackJobSchema.orgId} = ${opts.orgId}
       AND ${feedbackJobSchema.source} = ${opts.source}
       AND ${feedbackJobSchema.externalId} = ${opts.externalId}`,
    );
  if (existing.length > 0) {
    return existing[0]!;
  }
  const [row] = await db
    .insert(feedbackJobSchema)
    .values({
      orgId: opts.orgId,
      source: opts.source,
      externalId: opts.externalId,
      payload: opts.payload as unknown as Record<string, unknown>,
      status: 'queued',
    })
    .returning();
  return row!;
}

/* ------------------------------------------------------------------ */
/* Claim + process one job                                             */
/* ------------------------------------------------------------------ */

const BOT_FILTER_EMAIL = (process.env.VOCION_BOT_EMAIL ?? '').toLowerCase();

export async function runOnce(): Promise<boolean> {
  // Claim oldest queued row with FOR UPDATE SKIP LOCKED — safe under
  // multi-worker, prevents lost-update on retry.
  const claimed = await db.execute<{ id: number; org_id: string; source: string; external_id: string; payload: Record<string, unknown>; attempts: number }>(sql`
    UPDATE feedback_job SET status = 'processing', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM feedback_job
      WHERE status = 'queued'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, org_id, source, external_id, payload, attempts
  `);

  const row = (claimed as unknown as { rows: Array<{ id: number; org_id: string; source: string; external_id: string; payload: Record<string, unknown>; attempts: number }> }).rows[0];
  if (!row) {
    return false;
  }

  try {
    const payload = row.payload as unknown as FeedbackPayload;

    // Anti-loop bot-author filter (e.g. comments authored by our own
    // bot account from a previous reply).
    const authorEmail = String(((row.payload as Record<string, unknown>).authorEmail ?? '')).toLowerCase();
    if (BOT_FILTER_EMAIL && authorEmail === BOT_FILTER_EMAIL) {
      await db.execute(sql`UPDATE feedback_job SET status = 'ignored' WHERE id = ${row.id}`);
      return true;
    }

    const classification = await classifyComment({
      text: payload.text ?? '',
      quotedText: payload.quotedText,
      artifactTitle: payload.artifactTitle,
      orgId: row.org_id,
    });

    await db.execute(sql`
      UPDATE feedback_job
      SET status = 'classified',
          classification = ${JSON.stringify({
            bucket: classification.bucket,
            editSummary: classification.edit_summary,
            ruleText: classification.rule_text,
            targetSlug: payload.targetSlug,
          })}::jsonb
      WHERE id = ${row.id}
    `);
    return true;
  } catch (err) {
    const msg = (err as Error).message ?? 'classifier failed';
    await db.execute(sql`
      UPDATE feedback_job
      SET status = 'failed', error = ${msg.slice(0, 1000)}
      WHERE id = ${row.id}
    `);
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

export type WorkerStopHandle = { stop: () => void; done: Promise<void> };

const POLL_INTERVAL_MS = 2000;

export function runLoop(): WorkerStopHandle {
  let stopped = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });

  (async () => {
    // eslint-disable-next-line no-console
    console.log('[feedback-worker] started');
    while (!stopped) {
      try {
        const processed = await runOnce();
        if (!processed) {
          await sleep(POLL_INTERVAL_MS, () => stopped);
        }
      } catch (err) {
        console.error('[feedback-worker] iteration failed', err);
        await sleep(POLL_INTERVAL_MS, () => stopped);
      }
    }
    // eslint-disable-next-line no-console
    console.log('[feedback-worker] stopped');
    resolveDone();
  })().catch((err) => {
    console.error('[feedback-worker] crashed', err);
    resolveDone();
  });

  return {
    stop: () => {
      stopped = true;
    },
    done,
  };
}

async function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  const start = Date.now();
  while (!cancelled() && Date.now() - start < ms) {
    await new Promise(r => setTimeout(r, Math.min(100, ms - (Date.now() - start))));
  }
}
