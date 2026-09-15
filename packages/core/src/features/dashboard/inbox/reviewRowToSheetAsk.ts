import type { SheetAsk } from './AskSheet';
import type { ReviewRow } from '@/services/inbox/reviewRows';
import { amountLabel, confidenceLabel, humaniseField } from '@/services/inbox/describeActionRun';

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
  const body = [
    changes,
    d.rationale ? `_${d.rationale}_` : null,
    facts || null,
  ].filter(Boolean).join('\n\n');
  const evidence = d.evidence.length > 0 ? d.evidence.map(e => `- ${/^https?:\/\//.test(e) ? `<${e}>` : e}`).join('\n') : null;
  const raw = `\`\`\`json\n${JSON.stringify(row.input, null, 2)}\n\`\`\``;

  return {
    id: row.id,
    kind: 'approval',
    title: d.title,
    body: body || null,
    options: [
      { id: 'approve', label: 'Approve', description: `Execute this ${d.actionKind.replace(/^[A-Z](?![A-Z])/, m => m.toLowerCase())} now.`, recommended: isRecommended(row, 'approve') },
      { id: 'reject', label: 'Reject', description: 'Do not do this. Add a note and the team learns from it.', recommended: isRecommended(row, 'reject') },
    ],
    contextUrl: '/dashboard/review',
    contextMd: [evidence ? `**Evidence**\n\n${evidence}` : null, `**Payload**\n\n${raw}`].filter(Boolean).join('\n\n'),
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
