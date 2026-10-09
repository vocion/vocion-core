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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { flushTraces, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { logger } from '@/libs/Logger';
import { fallbackLabel, LABEL_SYSTEM, LABEL_VERSION, labelPrompt, parseLabel, priorFromMetadata, reuse, ruleLabel, threadStateExternalId } from '@/libs/sources/mailThreadState';
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
 *
 * A label belongs to a MAILBOX and a Gmail thread, not to the source that
 * filed it: the same mailbox is often connected in more than one workspace of
 * an Org (on 2026-10-09 Metacto's Executive and Revenue Team workspaces held
 * the same 3,347 threads), and labelling it once per workspace paid twice for
 * one answer. So with a mailbox, a label on file in ANY workspace of the same
 * Org for that mailbox and thread is reused — never across Orgs, and never
 * from another mailbox. This source's own label wins when both exist.
 * @param orgId - The workspace.
 * @param sourceId - The source the threads belong to.
 * @param connector - The connector slug, for the external ids.
 * @param threadIds - The threads.
 * @param mailbox - The owner's address; without it only this source's labels are read.
 */
export async function priorLabels(orgId: string, sourceId: number, connector: string, threadIds: string[], mailbox?: string): Promise<Map<string, PriorLabel>> {
  const out = new Map<string, PriorLabel>();
  if (threadIds.length === 0) {
    return out;
  }
  const byExternal = new Map(threadIds.map(id => [threadStateExternalId(connector, id), id]));
  const ids = [...byExternal.keys()];
  // Workspaces in the same Org: where the same mailbox's labels may already be.
  let orgIds = [orgId];
  if (mailbox) {
    const { projectSchema } = await import('@/models/Schema');
    const [own] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    if (own) {
      orgIds = (await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.accountId, own.accountId))).map(p => p.id);
    }
  }
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ externalId: knowledgeDocumentSchema.externalId, metadata: knowledgeDocumentSchema.metadata, sourceId: knowledgeDocumentSchema.sourceId })
      .from(knowledgeDocumentSchema)
      .where(and(
        inArray(knowledgeDocumentSchema.orgId, orgIds),
        mailbox
          ? sql`(${knowledgeDocumentSchema.sourceId} = ${sourceId} OR lower(${knowledgeDocumentSchema.metadata} -> 'facets' ->> 'mailbox') = ${mailbox.toLowerCase()})`
          : eq(knowledgeDocumentSchema.sourceId, sourceId),
        inArray(knowledgeDocumentSchema.externalId, ids.slice(i, i + 500)),
      ));
    // This source's own row first, so it wins over a copy elsewhere.
    rows.sort((x, y) => Number(y.sourceId === sourceId) - Number(x.sourceId === sourceId));
    for (const r of rows) {
      const prior = priorFromMetadata(r.metadata);
      const threadId = byExternal.get(r.externalId);
      if (!prior || !threadId) {
        continue;
      }
      const held = out.get(threadId);
      // A model's label beats a headers-only fallback from elsewhere, and a
      // label from a newer prompt beats an older one — so after a relabel of
      // one workspace, the same mailbox's other workspaces pick it up free.
      const better = held && prior.label.labelledBy !== 'rule'
        && (held.label.labelledBy === 'rule' || (prior.label.version ?? 1) > (held.label.version ?? 1));
      if (!held || better) {
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
 * @param opts.relabelBelow - Relabel labels made under an older prompt version (explicit relabels only).
 */
export async function labelThreads(opts: {
  orgId: string;
  sourceSlug: string;
  threads: ThreadFacts[];
  prior: Map<string, PriorLabel>;
  maxLabels?: number;
  model?: LabelModel;
  /** An explicit relabel: a label made under an older prompt than this is bought again. */
  relabelBelow?: number;
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
    const kept = reuse(opts.prior.get(facts.threadId), facts, opts.relabelBelow ? { minVersion: opts.relabelBelow } : {});
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

/* ------------------------------------------------------------------ */
/* Backfill: thread state for mail synced before it existed            */
/* ------------------------------------------------------------------ */

/** What one labelled thread costs, in cents: ~450 in + ~60 out tokens on Haiku 4.5. */
export const CENTS_PER_LABEL = 0.08;
/** Threads per batch: one checkpointed step, one pause after it. */
export const BACKFILL_BATCH = 50;
/** The pause between batches, so a backfill never crowds the mailbox's API quota or the model. */
export const BACKFILL_PAUSE_MS = 2_000;

export type BackfillPlan = {
  orgId: string;
  sourceId: number;
  sourceSlug: string;
  mailbox: string;
  windowDays: number;
  /** Labels made under an older prompt are bought again (`LABEL_VERSION`). */
  relabel: boolean;
  threadIds: string[];
  /** Threads that already carry a model label (skipped at no cost, unless their last message changed). */
  alreadyLabelled: number;
  /** Worst case: every thread not yet labelled needs the model (the headers settle many for free). */
  maxLabels: number;
  maxCents: number;
};

/**
 * Plan a source's backfill: the threads in the window and the most it can
 * cost. Lists ids only — no thread is read and no model is called.
 * @param opts - Which source and how far back.
 * @param opts.orgId - The workspace.
 * @param opts.sourceId - The Gmail source.
 * @param opts.windowDays - How far back (default 30).
 * @param opts.now - The clock.
 * @param opts.relabel - Price relabelling threads labelled under an older prompt.
 */
export async function planThreadStateBackfill(opts: { orgId: string; sourceId: number; windowDays?: number; now?: Date; relabel?: boolean }): Promise<BackfillPlan | null> {
  const windowDays = opts.windowDays ?? 30;
  const now = opts.now ?? new Date();
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const [source] = await db.select({ slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson, apiTokenId: knowledgeSourceSchema.apiTokenId }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.id, opts.sourceId), eq(knowledgeSourceSchema.orgId, opts.orgId))).limit(1);
  if (!source) {
    return null;
  }
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const credentials = await getCredentialsForConnector({ orgId: opts.orgId, connectorSlug: 'gmail', apiTokenId: source.apiTokenId });
  const { windowThreadIds } = await import('@/libs/sources/gmail');
  const listed = await windowThreadIds({ orgId: opts.orgId, credentials, after: new Date(now.getTime() - windowDays * 86_400_000) });
  if (!listed) {
    return null;
  }
  const prior = await priorLabels(opts.orgId, opts.sourceId, 'gmail', listed.threadIds, listed.mailbox);
  const alreadyLabelled = [...prior.values()].filter(p => p.label.labelledBy !== 'rule' && (!opts.relabel || (p.label.version ?? 1) >= LABEL_VERSION)).length;
  const maxLabels = listed.threadIds.length - alreadyLabelled;
  return { orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: source.slug, mailbox: listed.mailbox, windowDays, relabel: !!opts.relabel, threadIds: listed.threadIds, alreadyLabelled, maxLabels, maxCents: Math.round(maxLabels * CENTS_PER_LABEL * 100) / 100 };
}

export type BackfillBatchResult = LabelRunCounts & { failed: number; filed: number };

/**
 * Work out, label and file the state of one batch of threads. Idempotent: a
 * thread whose last message already carries a model label is reused at no
 * cost, and filing the same state document again changes nothing.
 * @param opts - The batch.
 * @param opts.orgId - The workspace.
 * @param opts.sourceId - The Gmail source.
 * @param opts.sourceSlug - Its slug.
 * @param opts.mailbox - The owner's address.
 * @param opts.threadIds - The batch's threads.
 * @param opts.model - Test seam.
 * @param opts.relabel - Relabel threads labelled under an older prompt.
 */
export async function backfillThreadStateBatch(opts: { orgId: string; sourceId: number; sourceSlug: string; mailbox: string; threadIds: string[]; model?: LabelModel; relabel?: boolean }): Promise<BackfillBatchResult> {
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const [source] = await db.select({ apiTokenId: knowledgeSourceSchema.apiTokenId }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, opts.sourceId)).limit(1);
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const credentials = await getCredentialsForConnector({ orgId: opts.orgId, connectorSlug: 'gmail', apiTokenId: source?.apiTokenId ?? null });
  const { gmailThreadUrl, threadFactsFor } = await import('@/libs/sources/gmail');
  const { threadStateDoc } = await import('@/libs/sources/mailThreadState');
  const { ingestDocument } = await import('@/services/IngestionService');
  const { facts, failed } = await threadFactsFor({ orgId: opts.orgId, credentials, mailbox: opts.mailbox, threadIds: opts.threadIds });
  const prior = await priorLabels(opts.orgId, opts.sourceId, 'gmail', facts.map(f => f.threadId), opts.mailbox);
  const { labels, counts } = await labelThreads({ orgId: opts.orgId, sourceSlug: opts.sourceSlug, threads: facts, prior, maxLabels: facts.length, ...(opts.model ? { model: opts.model } : {}), ...(opts.relabel ? { relabelBelow: LABEL_VERSION } : {}) });
  let filed = 0;
  for (const f of facts) {
    const label = labels.get(f.threadId);
    if (label) {
      await ingestDocument({ orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: opts.sourceSlug }, threadStateDoc(f, label, { connector: 'gmail', uri: gmailThreadUrl(opts.mailbox, f.threadId) }));
      filed += 1;
    }
  }
  return { ...counts, failed, filed };
}

/**
 * The whole backfill for one source, batch by batch, each batch through
 * `step` (a durable step when run as the `mail.thread-state-backfill` job, so
 * a restart resumes after the last finished batch) with a pause after it.
 * Every label is charged to `platform:retrieval.state` as it is made.
 * @param plan - From `planThreadStateBackfill`.
 * @param run - How to take a step and pause; inline by default.
 * @param run.step - Run one named step.
 * @param run.sleep - Pause.
 * @param run.log - Progress.
 * @param run.model - Test seam.
 */
export async function runThreadStateBackfill(
  plan: BackfillPlan,
  run: { step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void; model?: LabelModel } = {},
): Promise<BackfillBatchResult> {
  const step = run.step ?? (<T>(_name: string, fn: () => Promise<T>) => fn());
  const sleep = run.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const total: BackfillBatchResult = { threads: 0, byRule: 0, reused: 0, labelled: 0, fallback: 0, failed: 0, filed: 0 };
  const batches = Math.ceil(plan.threadIds.length / BACKFILL_BATCH);
  for (let b = 0; b < batches; b++) {
    const ids = plan.threadIds.slice(b * BACKFILL_BATCH, (b + 1) * BACKFILL_BATCH);
    const r = await step(`batch-${b}`, () => backfillThreadStateBatch({ orgId: plan.orgId, sourceId: plan.sourceId, sourceSlug: plan.sourceSlug, mailbox: plan.mailbox, threadIds: ids, relabel: plan.relabel, ...(run.model ? { model: run.model } : {}) }));
    for (const k of Object.keys(total) as Array<keyof BackfillBatchResult>) {
      total[k] += r[k];
    }
    run.log?.(`thread-state backfill ${plan.sourceSlug} (${plan.orgId}): batch ${b + 1}/${batches} — ${total.filed} filed, ${total.labelled} labelled, ${total.reused} reused, ${total.byRule} by headers, ${total.fallback} left for the next sync, ${total.failed} unreadable; ~${(total.labelled * CENTS_PER_LABEL / 100).toFixed(2)} USD`);
    if (b < batches - 1) {
      await sleep(BACKFILL_PAUSE_MS);
    }
  }
  return total;
}
