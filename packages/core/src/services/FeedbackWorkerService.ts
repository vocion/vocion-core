/**
 * FeedbackWorkerService — Phase 6.
 *
 * Long-lived poll loop that drains `feedback_job` rows queued by
 * webhooks (Drive comments, Slack reactions, etc.) and manual UI
 * feedback. At-least-once delivery via Postgres `FOR UPDATE
 * SKIP LOCKED`. Each job is classified via the Haiku classifier;
 * the resulting bucket is stored back on the row.
 *
 * The worker DOES NOT auto-commit learnings. When a classification proposes
 * rule text, it records a **learning candidate** — a suggestion sitting in a
 * queue — and stops there. A person adopts it (in the dashboard, or through
 * `/api/v1/learning-candidates`) or rejects it with a reason. The worker's role
 * is to triage and queue, never to change how an agent behaves.
 *
 * Architecture: Next.js / Vercel cannot host this loop. Ship as a
 * separate process via `npm run worker:serve` (entry:
 * scripts/worker-serve.ts). Opt-in via ENABLE_FEEDBACK_WORKER=1.
 */

import type { Classification } from './feedback/classifier';
import { and, desc, eq, sql } from 'drizzle-orm';
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
  /**
   * The agent whose output drew the feedback. Set by review-queue and run
   * feedback, absent for a comment on a document nobody attributed.
   */
  agentSlug?: string;
  /** The run being reacted to — an action, workflow or mission run id. */
  sourceRunId?: number;
  /** Who gave the feedback, so the resulting rule can name its evidence. */
  submittedBy?: string;
  /**
   * What the surface already knows about the direction of the feedback: a
   * rejection is a correction, a thumbs-up is reinforcement. The classifier
   * still has the final say — this is the prior, not the answer.
   */
  polarityHint?: 'correct' | 'reinforce';
};

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

/**
 * Where a piece of feedback came from. `api` is an external client posting to
 * `/api/v1/feedback` — an admin panel outside Vocion, typically.
 */
export type FeedbackSource = 'drive' | 'slack' | 'manual' | 'api' | 'review';

export async function enqueue(opts: {
  orgId: string;
  source: FeedbackSource;
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

export type ListJobsOptions = {
  status?: string;
  source?: string;
  limit?: number;
  offset?: number;
};

/**
 * A page of an org's feedback jobs, newest first, with the total the filters
 * matched. Lets a client watch a piece of feedback move from `queued` to
 * `classified` and on into a learning candidate.
 * @param orgId
 * @param opts
 */
export async function listJobs(
  orgId: string,
  opts: ListJobsOptions = {},
): Promise<{ items: Array<typeof feedbackJobSchema.$inferSelect>; total: number; limit: number; offset: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const filters = [eq(feedbackJobSchema.orgId, orgId)];
  if (opts.status) {
    filters.push(eq(feedbackJobSchema.status, opts.status));
  }
  if (opts.source) {
    filters.push(eq(feedbackJobSchema.source, opts.source));
  }
  const where = and(...filters);

  const [items, [counted]] = await Promise.all([
    db.select().from(feedbackJobSchema).where(where).orderBy(desc(feedbackJobSchema.id)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(feedbackJobSchema).where(where),
  ]);
  return { items, total: counted?.total ?? 0, limit, offset };
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
            polarity: classification.polarity ?? payload.polarityHint,
            targetSlug: payload.targetSlug,
          })}::jsonb
      WHERE id = ${row.id}
    `);

    await recordLearningCandidate(row.id, row.org_id, classification, payload);
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

/**
 * Turn a classification that proposed a rule into queue state.
 *
 * Still no auto-commit: a candidate is a suggestion sitting in a queue, and only
 * a person approving it writes a real `learning` row. `recordProposedRule` owns
 * what happens next — a new candidate, or an occurrence bump on a rule that
 * already says the same thing.
 *
 * Feedback that names no learning step is no longer dropped: the recorder falls
 * back to the org's first step, which is what makes review-queue feedback (which
 * knows about actions, not steps) usable at all.
 *
 * A failure here must not fail the job — the classification is already saved,
 * and losing the candidate is recoverable while re-running the classifier costs
 * another model call.
 * @param feedbackJobId
 * @param orgId
 * @param classification - What the classifier decided.
 * @param payload - The queued job's payload, for evidence and attribution.
 */
async function recordLearningCandidate(
  feedbackJobId: number,
  orgId: string,
  classification: Classification,
  payload: FeedbackPayload,
): Promise<void> {
  if (!classification.rule_text?.trim()) {
    return;
  }
  try {
    const { recordProposedRule } = await import('@/services/feedback/ruleRecorder');
    await recordProposedRule({
      orgId,
      ruleText: classification.rule_text,
      polarity: classification.polarity ?? payload.polarityHint ?? 'correct',
      stepName: payload.targetSlug,
      note: payload.text,
      agentSlug: payload.agentSlug,
      sourceFeedbackJobId: feedbackJobId,
      sourceRunId: payload.sourceRunId,
      submittedBy: payload.submittedBy,
    });
  } catch (error) {
    console.error(`[FeedbackWorkerService] could not record a learning candidate for job ${feedbackJobId}`, error);
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
    // eslint-disable-next-line no-unmodified-loop-condition -- `stopped` flips via the closure from stop() below
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
