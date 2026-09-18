import type { SheetAsk } from './AskSheet';
import type { ReviewRow } from '@/services/inbox/reviewRows';
import { amountLabel, confidenceLabel, humaniseField } from '@/services/inbox/describeActionRun';
import { inboxHref } from '@/services/inbox/inboxRef';

/**
 * A proposed action as one question on a decision sheet: the human title, a
 * short body (what changes, why the agent proposed it, how sure it was),
 * Approve / Reject as the two rows, and the evidence collapsed underneath.
 * The id is the action run's — `AskSheet` with `endpoint="review"` decides it
 * through `POST /api/v1/reviews/decide`, so authorization is the review
 * queue's, not the sheet's.
 * @param row
 */
export function reviewRowToSheetAsk(row: ReviewRow): SheetAsk {
  const d = row.described;
  const changes = d.changes.length > 0
    ? d.changes.map(c => `- **${humaniseField(c.field)}**: ${c.from !== undefined ? `${c.from} → ` : ''}${c.to}`).join('\n')
    : null;
  const facts = [
    d.amount !== null ? `Amount ${amountLabel(d.amount, d.currency)}` : null,
    d.confidence !== null ? `Confidence ${confidenceLabel(d.confidence)}` : null,
  ].filter(Boolean).join(' · ');
  // The reason is rendered in full by the sheet's "Why you're seeing this"
  // block (`ReviewReason`) when the caller passes `reason`; here the body
  // keeps only what changes and the facts, so nothing is said twice and the
  // reason is never an italic afterthought (Chris, 2026-09-18).
  const body = [
    changes,
    facts || null,
  ].filter(Boolean).join('\n\n');
  const raw = `\`\`\`json\n${JSON.stringify(row.input, null, 2)}\n\`\`\``;

  return {
    id: row.id,
    kind: 'approval',
    title: d.title,
    subline: d.subline,
    body: body || null,
    options: [
      { id: 'approve', label: 'Approve', description: `Execute this ${d.actionKind.replace(/^[A-Z](?![A-Z])/, m => m.toLowerCase())} now.`, recommended: isRecommended(row, 'approve') },
      { id: 'reject', label: 'Reject', description: 'Do not do this. Add a note and the team learns from it.', recommended: isRecommended(row, 'reject') },
    ],
    contextUrl: inboxHref('proposal', row.id),
    // Evidence travels structurally, not as markdown bullets: each citation
    // is a reference the reviewer can open in the preview panel without
    // leaving the decision. See features/preview.
    evidence: d.evidence,
    contextMd: `**Payload**\n\n${raw}`,
    agentSlug: d.agentSlug,
    teamSlug: null,
    risk: null,
  };
}

/**
 * The agent's own recommendation (#321) becomes the pre-selected row.
 * @param row
 * @param verb
 */
function isRecommended(row: ReviewRow, verb: 'approve' | 'reject'): boolean {
  const suggested = row.proposal?.suggestedDecision;
  const decision = suggested && typeof suggested === 'object' ? (suggested as { decision?: unknown }).decision : suggested;
  return decision === verb;
}
