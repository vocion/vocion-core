import type { SheetAsk } from './AskSheet';
import type { ReviewRow } from '@/services/inbox/reviewRows';
import { sheetHeadline } from '@/features/review/reviewSheetModel';
import { amountLabel, confidenceLabel, humaniseField, recordTitle } from '@/services/inbox/describeActionRun';
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
  // The reason is rendered in full inside the sheet's "Why this?" fold
  // (`ReviewWhy`) when the caller passes it; the work card renders the changes
  // themselves. What is left for the body is the facts the card does not
  // carry, and it lives in the same fold, so nothing is said twice
  // (Chris, 2026-09-18, 2026-09-19).
  const body = [
    changes,
    facts || null,
  ].filter(Boolean).join('\n\n');
  const raw = `\`\`\`json\n${JSON.stringify(row.input, null, 2)}\n\`\`\``;

  return {
    id: row.id,
    kind: 'approval',
    // The stored kind stays `approval`; this is what the header calls it.
    kindLabel: d.actionKind,
    isEmail: row.actionId === 'gmail.send',
    draft: row.input.draft === true,
    title: d.title,
    headline: sheetHeadline({
      isEmail: row.actionId === 'gmail.send',
      subject: typeof row.input.subject === 'string' ? row.input.subject : null,
      recordName: d.record ? recordTitle(d.record) : null,
      title: d.title,
    }),
    subline: d.subline,
    body: body || null,
    options: [
      // The confidence rides the recommended option, which is where the
      // header reads it from — a meter beside a verdict it belongs to.
      { id: 'approve', label: 'Approve', description: `Execute this ${d.actionKind.replace(/^[A-Z](?![A-Z])/, m => m.toLowerCase())} now.`, recommended: isRecommended(row, 'approve'), ...(d.confidence !== null ? { confidence: d.confidence } : {}) },
      { id: 'reject', label: 'Reject', description: 'Do not do this. Add a note and the team learns from it.', recommended: isRecommended(row, 'reject'), ...(d.confidence !== null ? { confidence: d.confidence } : {}) },
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
