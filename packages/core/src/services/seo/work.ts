/**
 * SEO work that runs in the BACKGROUND, never inside a person's chat turn.
 *
 * Each hand-off below now starts the pipeline's workflows (`pipeline.ts`):
 * one run per released page, the editor's rounds and the person's sign-off
 * inside it. What follows describes the event the hand-off still raises for
 * a workspace whose SEO app has not been upgraded to them.
 *
 * Writing and reviewing a batch is many strong-model calls; inside a chat
 * turn it ran into the turn's spend ceiling mid-review (dev run, 2026-10-27).
 * So the hand-offs are code: each one raises `seo.work_queued`, and the SEO
 * plugin's `seo-continue` automation runs the strategist's standing mission
 * (`seo-batches-moving`) as a durable mission run — its own budget on the SEO
 * team's agents, resumable like any mission run, the person's turn only
 * starting it. Progress lands on the batch and page records (the gate line,
 * statuses, models) and, when the work was started from a conversation, in
 * that conversation (`tellConversation`).
 *
 *   write     a person asked for the released pages (`seo_start_writing`)
 *   revise    the editor sent a draft back: the writer revises it with the
 *             editor's findings, then the editor reviews again — at most
 *             `SEO_EDITOR_ROUNDS` times, then the sign-off is filed anyway
 *             with the open findings shown, so the person decides
 *   signoff   a person answered a plan or page sign-off
 *   opportunities  the weekly cadence check found a project behind its
 *             pages a month (`cadence.ts`): plan just the pages it is short
 */

import type { GateState } from './gate';
import type { SeoBatchMeta, SeoBatchRecord } from './records';
import { createHash } from 'node:crypto';
import { getSeoBatch, mergeMeta, readSeoGate } from './records';

/** Who raises `seo.work_queued`: the fires it starts carry it as `invokedBy`. */
export const SEO_WORK_INVOKER = 'seo';

/** How many times the editor may send one draft back before a person decides. */
export const SEO_EDITOR_ROUNDS = 3;

/** Each finding's fields are kept to this many characters; a long review is never refused for it. */
const FINDING_FIELD_MAX = 600;
/** At most this many findings are kept on the page; the full review is an artifact. */
const FINDINGS_MAX = 30;

export type SeoFinding = { issue: string; location?: string; fix?: string };

export type SeoWorkReason = 'write' | 'revise' | 'signoff' | 'opportunities';

/**
 * The editor's findings as the page keeps them: each field trimmed to its
 * cap, empty ones dropped, at most `FINDINGS_MAX`. Never throws on length.
 * @param raw - The findings as the model sent them (objects or strings).
 */
export function normaliseFindings(raw: unknown): SeoFinding[] {
  const list = Array.isArray(raw) ? raw : [];
  const cut = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, FINDING_FIELD_MAX) : '');
  return list
    .map((f): SeoFinding | null => {
      if (typeof f === 'string') {
        return cut(f) ? { issue: cut(f) } : null;
      }
      const o = (f ?? {}) as Record<string, unknown>;
      const issue = cut(o.issue);
      if (!issue) {
        return null;
      }
      const location = cut(o.location);
      const fix = cut(o.fix);
      return { issue, ...(location ? { location } : {}), ...(fix ? { fix } : {}) };
    })
    .filter((f): f is SeoFinding => f !== null)
    .slice(0, FINDINGS_MAX);
}

/**
 * The findings as a person (or the writer) reads them.
 * @param findings - The findings.
 */
export function findingsMd(findings: readonly SeoFinding[]): string {
  return findings.map((f, i) => `${i + 1}. ${f.issue}${f.location ? ` (${f.location})` : ''}${f.fix ? ` — fix: ${f.fix}` : ''}`).join('\n');
}

/**
 * Queue SEO work for the strategist's background run. Never throws: the
 * record that asked for it is already written, and a failed queue is logged.
 * @param orgId - The workspace.
 * @param reason - Why.
 * @param payload - What the run needs: the batch, the page, the findings.
 * @param dedupeKey - Once per this key.
 */
export async function queueSeoWork(orgId: string, reason: SeoWorkReason, payload: Record<string, unknown>, dedupeKey: string): Promise<boolean> {
  try {
    // The pipeline's workflows, where the SEO app has them (`pipeline.ts`).
    const { startSeoPipeline } = await import('./pipeline');
    if (await startSeoPipeline(orgId, reason, payload)) {
      return true;
    }
    // Not upgraded yet: the old background automation answers the event.
    const { emitEvent, SEO_WORK_QUEUED } = await import('@/services/EventService');
    await emitEvent({ orgId, type: SEO_WORK_QUEUED, payload: { reason, ...payload }, dedupeKey: `${SEO_WORK_QUEUED}:${dedupeKey}`, invokedBy: SEO_WORK_INVOKER, dispatchMode: 'auto' });
    return true;
  } catch (err) {
    const { logger } = await import('@/libs/Logger');
    logger.warn('SEO work could not be queued', { orgId, reason, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Remember the conversation a batch's work was started from, so progress is
 * said there.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 * @param conversationId - The conversation.
 */
export async function followFrom(orgId: string, batchId: number, conversationId: number | null | undefined): Promise<void> {
  if (conversationId) {
    await mergeMeta<SeoBatchMeta>(orgId, batchId, () => ({ conversationId }));
  }
}

/**
 * Say one line in the conversation a batch's work was started from, once per
 * key. Silent when nobody started it from a conversation. Never throws.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 * @param text - The line.
 * @param key - Said once per key.
 */
export async function tellBatch(orgId: string, batchId: number, text: string, key: string): Promise<void> {
  try {
    const batch = await getSeoBatch(orgId, batchId);
    const conversationId = batch?.meta.conversationId;
    if (!conversationId) {
      return;
    }
    const { tellConversation } = await import('@/services/chat/tellConversation');
    await tellConversation(orgId, conversationId, text, { key: `seo:${key}`, url: `/dashboard/p/seo-pages?batch=${batchId}` });
  } catch {
    // Progress is a courtesy; the records already say where things stand.
  }
}

/**
 * What a background run says in the conversation a batch was started from,
 * read off the records, never the run's prose: the batch's gate line and
 * what waits on whom. Null when nothing changed since the last line said
 * there — a run that found nothing to write and moved nothing stays silent
 * (a live run posted "writeNow 0 · waiting 1" again while nothing had moved,
 * 2026-10-27). Pure.
 * @param batch - The batch, with the state last said (`meta.toldState`).
 * @param gate - The batch's view of the project's gate, read after the run.
 */
export function seoRunReport(batch: Pick<SeoBatchRecord, 'id' | 'title'> & { meta: Pick<SeoBatchMeta, 'toldState'> }, gate: Pick<GateState, 'line' | 'writable' | 'waitingOnSignoff' | 'feedbackToFile' | 'written' | 'approved' | 'total' | 'stage'>): { text: string; state: string } | null {
  const state = createHash('sha256').update(JSON.stringify([gate.stage, gate.line, gate.written, gate.approved, gate.total, [...gate.writable].sort(), [...gate.waitingOnSignoff].sort(), [...gate.feedbackToFile].sort()])).digest('hex').slice(0, 16);
  if (batch.meta.toldState === state) {
    return null;
  }
  const waiting = gate.waitingOnSignoff.length;
  return {
    state,
    text: `${batch.title}: ${gate.line}.${waiting > 0 ? ` ${waiting === 1 ? '1 page is' : `${waiting} pages are`} waiting on your sign-off.` : ''}`,
  };
}

/**
 * After a background SEO run: say where its batch stands in the conversation
 * it was started from, once per state (`seoRunReport`). Silent when nobody
 * started it from a conversation or nothing changed. Never throws.
 * @param orgId - The workspace.
 * @param batchId - The batch the run was queued for.
 * @param tell - How the line is said (tests).
 */
export async function reportSeoRun(orgId: string, batchId: number, tell: typeof tellBatch = tellBatch): Promise<'said' | 'silent'> {
  try {
    const read = await readSeoGate(orgId, batchId);
    if (!read?.batch.meta.conversationId) {
      return 'silent';
    }
    const report = seoRunReport(read.batch, read.gate);
    if (!report) {
      return 'silent';
    }
    await tell(orgId, batchId, report.text, `report:${batchId}:${report.state}`);
    await mergeMeta<SeoBatchMeta>(orgId, batchId, () => ({ toldState: report.state }));
    return 'said';
  } catch {
    return 'silent';
  }
}
