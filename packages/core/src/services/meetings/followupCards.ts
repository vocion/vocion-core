/**
 * ONE DECISION PER CALL — the lookups that keep a call to one review item and
 * say when its record is released.
 *
 * Two lanes can card the same call: the meeting follow-up (`meeting.draft_followup`,
 * every client or prospect call) and the discovery ledger
 * (`discovery.review_proposal`, every matched call). Both cards are the
 * person's release of a private record, so a call gets one of them:
 *
 *   - a follow-up card stands in for a discovery card still waiting on the
 *     same call (the discovery card is closed, saying so);
 *   - a discovery card is not filed beside a follow-up card (its `underway`);
 *   - a discovery card a person already approved IS the release — the
 *     follow-up drafts from it without asking again.
 *
 * Two captures of one call (a recording and a note) are the same call: they
 * share `meetingKey` (owner + start to the half hour).
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, discoveryCandidateSchema, knowledgeDocumentSchema } from '@/models/Schema';
import { captureOf } from './captures';
import { meetingKey as keyOf } from './meetingKey';

export const FOLLOWUP_ACTION = 'meeting.draft_followup';
const DISCOVERY_ACTION = 'discovery.review_proposal';
/** Review statuses that mean a person approved the item. */
const APPROVED = ['approved', 'executing', 'done'];
/** How far back a discovery card is looked for. */
const LOOKBACK_DAYS = 14;

/**
 * The meeting key of a captured document named by its external id, or null.
 * @param orgId - The workspace.
 * @param externalId - `zoom:<uuid>`, `granola:<id>`.
 */
export async function meetingKeyForExternalId(orgId: string, externalId: string): Promise<{ key: string; documentId: number } | null> {
  const [row] = await db
    .select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata, lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), eq(knowledgeDocumentSchema.externalId, externalId)))
    .limit(1);
  const capture = row ? captureOf(row) : null;
  return capture ? { key: keyOf(capture), documentId: capture.documentId } : null;
}

/**
 * The follow-up card for a meeting, any status, or null.
 * @param orgId - The workspace.
 * @param key - The meeting key.
 */
export async function followupCardFor(orgId: string, key: string): Promise<{ id: number; status: string } | null> {
  const [row] = await db
    .select({ id: actionRunSchema.id, status: actionRunSchema.status })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.actionId, FOLLOWUP_ACTION), eq(actionRunSchema.dedupKey, `${FOLLOWUP_ACTION}:${key}`)))
    .limit(1);
  return row ?? null;
}

/**
 * The discovery cards on the same call: those still waiting, and one a person
 * approved (with the run its approval started).
 * @param orgId - The workspace.
 * @param key - The meeting key.
 * @param now - The clock.
 */
export async function discoveryCardsFor(orgId: string, key: string, now: Date = new Date()): Promise<{ pending: number[]; approved: { runId: number; missionRunId: number | null; documentId: number | null } | null }> {
  const rows = await db
    .select({ id: actionRunSchema.id, status: actionRunSchema.status, input: actionRunSchema.input, result: actionRunSchema.result })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, DISCOVERY_ACTION),
      inArray(actionRunSchema.status, ['pending', 'failed', ...APPROVED]),
      gte(actionRunSchema.createdAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
    ));
  const externalIds = [...new Set(rows.map(r => r.input?.meetingExternalId).filter((x): x is string => typeof x === 'string'))];
  if (externalIds.length === 0) {
    return { pending: [], approved: null };
  }
  const docs = await db
    .select({ id: knowledgeDocumentSchema.id, externalId: knowledgeDocumentSchema.externalId, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata, lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.externalId, externalIds)));
  const sameCall = new Set(docs.filter((d) => {
    const c = captureOf(d);
    return c !== null && keyOf(c) === key;
  }).map(d => d.externalId));
  const mine = rows.filter(r => sameCall.has(String(r.input?.meetingExternalId ?? '')));
  const approvedRow = mine.find(r => APPROVED.includes(r.status) && (r.input?.route === 'generate' || r.input?.route === 'confirm'));
  return {
    pending: mine.filter(r => r.status === 'pending' || r.status === 'failed').map(r => r.id),
    approved: approvedRow
      ? {
          runId: approvedRow.id,
          missionRunId: typeof approvedRow.result?.missionRunId === 'number' ? approvedRow.result.missionRunId : null,
          documentId: docs.find(d => d.externalId === approvedRow.input?.meetingExternalId)?.id ?? null,
        }
      : null,
  };
}

/**
 * Close discovery cards a follow-up card stands in for. A machine's close,
 * not a person's decision: the card says why, and the classification stays on
 * the ledger.
 * @param orgId - The workspace.
 * @param runIds - The discovery cards.
 * @param by - The follow-up card that replaces them.
 */
export async function supersedeDiscoveryCards(orgId: string, runIds: number[], by: number): Promise<void> {
  if (runIds.length === 0) {
    return;
  }
  await db
    .update(actionRunSchema)
    .set({ status: 'closed', error: `Folded into this call's follow-up card (proposal-${by}): approving that one releases the call and drafts the follow-up.` })
    .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, runIds), inArray(actionRunSchema.status, ['pending', 'failed'])));
}

/**
 * Whether a person released this captured document's record: its follow-up
 * card was approved, or its discovery card was approved with a route that
 * reads it.
 * @param orgId - The workspace.
 * @param documentId - The knowledge document.
 */
export async function recordReleased(orgId: string, documentId: number): Promise<boolean> {
  const [card] = await db
    .select({ id: actionRunSchema.id })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, FOLLOWUP_ACTION),
      inArray(actionRunSchema.status, APPROVED),
      sql`(${actionRunSchema.input}->>'documentId')::int = ${documentId}`,
    ))
    .limit(1);
  if (card) {
    return true;
  }
  const { transcriptReleased } = await import('@/services/discovery/release');
  const candidates = await db
    .select({ route: discoveryCandidateSchema.route, reviewStatus: actionRunSchema.status, reviewInput: actionRunSchema.input })
    .from(discoveryCandidateSchema)
    .leftJoin(actionRunSchema, eq(actionRunSchema.id, discoveryCandidateSchema.reviewActionRunId))
    .where(and(eq(discoveryCandidateSchema.orgId, orgId), eq(discoveryCandidateSchema.meetingDocId, documentId)));
  return candidates.some(c => transcriptReleased({ route: c.route, reviewStatus: c.reviewStatus, reviewRoute: typeof c.reviewInput?.route === 'string' ? c.reviewInput.route : null }));
}
