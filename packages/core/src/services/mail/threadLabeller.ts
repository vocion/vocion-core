/**
 * Label the threads one sync touched — the paid half of thread state
 * (`libs/sources/mailThreadState.ts` holds the free half and the reasons).
 *
 * Per thread, cheapest first:
 *   1. the facts settle it (the owner wrote last; bulk mail) — no call;
 *   2. the label on file still describes it (same last message) — no call;
 *   3. one classifier call, charged to `platform:retrieval.state` like every
 *      other paid call (`chargeModelCall`).
 *
 * Bounded twice: a per-run allowance of model calls (`maxLabels`), and the
 * feature's spend cap, read once before any call. Past either, a thread gets
 * its facts-only label (`fallbackLabel`) and the next sync labels it. A failed
 * or unparseable call does the same, so labelling can never fail a sync.
 */
import type { PriorLabel, ThreadFacts, ThreadLabel } from '@/libs/sources/mailThreadState';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { flushTraces, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { logger } from '@/libs/Logger';
import { fallbackLabel, LABEL_SYSTEM, labelPrompt, parseLabel, priorFromMetadata, reuse, ruleLabel, threadStateExternalId } from '@/libs/sources/mailThreadState';
import { knowledgeDocumentSchema } from '@/models/Schema';

/** Model calls one sync may spend labelling, unless the environment says otherwise. */
export const DEFAULT_MAX_LABELS_PER_SYNC = 200;
/** Calls in flight at once. */
const CONCURRENCY = 6;
/** One label is a few dozen tokens; a slow call is skipped, not waited on. */
const CALL_TIMEOUT_MS = 15_000;

/** Test seam: one classifier call. Returns the reply text, the model id, and the raw response for charging. */
export type LabelModel = (system: string, user: string) => Promise<{ text: string; model: string; response?: unknown }>;

export type LabelRunCounts = { threads: number; byRule: number; reused: number; labelled: number; fallback: number };

/**
 * The labels on file for these threads, by thread id.
 * @param orgId - Tenant.
 * @param sourceId - The source the threads belong to.
 * @param connector - The connector slug, for the external ids.
 * @param threadIds - The threads.
 */
export async function priorLabels(orgId: string, sourceId: number, connector: string, threadIds: string[]): Promise<Map<string, PriorLabel>> {
  const out = new Map<string, PriorLabel>();
  if (threadIds.length === 0) {
    return out;
  }
  const byExternal = new Map(threadIds.map(id => [threadStateExternalId(connector, id), id]));
  const ids = [...byExternal.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ externalId: knowledgeDocumentSchema.externalId, metadata: knowledgeDocumentSchema.metadata })
      .from(knowledgeDocumentSchema)
      .where(and(
        eq(knowledgeDocumentSchema.orgId, orgId),
        eq(knowledgeDocumentSchema.sourceId, sourceId),
        inArray(knowledgeDocumentSchema.externalId, ids.slice(i, i + 500)),
      ));
    for (const r of rows) {
      const prior = priorFromMetadata(r.metadata);
      const threadId = byExternal.get(r.externalId);
      if (prior && threadId) {
        out.set(threadId, prior);
      }
    }
  }
  return out;
}

async function defaultModel(orgId: string): Promise<LabelModel> {
  const { buildChatModelForOrg, resolvedModelId } = await import('@/libs/llm/langchain');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 200, streaming: false });
  const id = resolvedModelId('classifier');
  return async (system, user) => {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: user }], { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    const c = response.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(part => (part as { text?: string }).text ?? '').join('') : '';
    const reported = (response.response_metadata as { model?: string } | undefined)?.model;
    return { text, model: reported ?? id, response };
  };
}

function configuredMax(): number {
  const raw = Number.parseInt(process.env.VOCION_MAIL_STATE_MAX_LABELS ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MAX_LABELS_PER_SYNC;
}

/**
 * Label every thread, spending as little as it can. Never throws.
 * @param opts - What to label and how.
 * @param opts.orgId - Tenant, whose budget pays.
 * @param opts.sourceSlug - For the trace.
 * @param opts.threads - The threads' facts.
 * @param opts.prior - Labels on file (`priorLabels`).
 * @param opts.maxLabels - Model calls this run may spend; defaults to `VOCION_MAIL_STATE_MAX_LABELS` or 200.
 * @param opts.model - Test seam.
 */
export async function labelThreads(opts: {
  orgId: string;
  sourceSlug: string;
  threads: ThreadFacts[];
  prior: Map<string, PriorLabel>;
  maxLabels?: number;
  model?: LabelModel;
}): Promise<{ labels: Map<string, ThreadLabel>; counts: LabelRunCounts }> {
  const labels = new Map<string, ThreadLabel>();
  const counts: LabelRunCounts = { threads: opts.threads.length, byRule: 0, reused: 0, labelled: 0, fallback: 0 };
  const toRead: ThreadFacts[] = [];
  for (const facts of opts.threads) {
    const settled = ruleLabel(facts);
    if (settled) {
      labels.set(facts.threadId, settled);
      counts.byRule += 1;
      continue;
    }
    const kept = reuse(opts.prior.get(facts.threadId), facts);
    if (kept) {
      labels.set(facts.threadId, kept);
      counts.reused += 1;
      continue;
    }
    toRead.push(facts);
  }

  let allowance = Math.min(opts.maxLabels ?? configuredMax(), toRead.length);
  if (allowance > 0) {
    try {
      const { preflightCheck } = await import('@/services/BudgetService');
      const budget = await preflightCheck({ orgId: opts.orgId, feature: FEATURES.RETRIEVAL_STATE });
      if (!budget.ok) {
        allowance = 0;
      }
    } catch {
      // A budget that cannot be read does not stop labelling; the charge below still records.
    }
  }
  // Newest first: the threads most likely to be asked about get the model.
  const ordered = [...toRead].sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  const reading = ordered.slice(0, allowance);
  for (const facts of ordered.slice(allowance)) {
    labels.set(facts.threadId, fallbackLabel(facts));
    counts.fallback += 1;
  }

  if (reading.length > 0) {
    const trace = traceFor({ feature: FEATURES.RETRIEVAL_STATE, slug: opts.sourceSlug, orgId: opts.orgId, userId: 'system', input: { threads: reading.length } });
    let model: LabelModel | null = opts.model ?? null;
    try {
      model ??= await defaultModel(opts.orgId);
    } catch (error) {
      logger.warn('thread labelling has no model; the facts decide this sync', { orgId: opts.orgId, error: error instanceof Error ? error.message : String(error) });
    }
    const queue = [...reading];
    const worker = async (): Promise<void> => {
      for (let facts = queue.shift(); facts; facts = queue.shift()) {
        let label: ThreadLabel | null = null;
        if (model) {
          try {
            const reply = await model(LABEL_SYSTEM, labelPrompt(facts));
            if (reply.response !== undefined) {
              const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
              await chargeModelCall({ orgId: opts.orgId, feature: FEATURES.RETRIEVAL_STATE, role: 'classifier', response: reply.response });
            }
            label = parseLabel(reply.text, reply.model);
          } catch (error) {
            logger.warn('a thread label call failed; the facts decide it this sync', { orgId: opts.orgId, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (label) {
          counts.labelled += 1;
        } else {
          label = fallbackLabel(facts);
          counts.fallback += 1;
        }
        labels.set(facts.threadId, label);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, reading.length) }, worker));
    trace.update({ output: counts });
    void flushTraces();
  }
  return { labels, counts };
}
