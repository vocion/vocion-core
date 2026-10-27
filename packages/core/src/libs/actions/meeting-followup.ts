/**
 * meeting.draft_followup — the ONE review item a client or prospect call
 * becomes: "Approve to draft the <meeting> follow-up".
 *
 * A call's record is private until a person says otherwise. Agents never read
 * it on their own (the same rule the discovery lane keeps with its content
 * gate); the classifier's typed read is the only thing that touches it
 * before a person does. So the item does two jobs in one tap: approving it
 * RELEASES the record to the follow-up writer (`read_meeting_record` answers
 * only for a capture whose card was approved) and STARTS the draft — the
 * approval raises `meeting.followup_approved`, the meeting-followup job runs
 * the writer, and the email lands in Review as `gmail.send` with the project's
 * deck or document attached as a PDF.
 *
 * Filed by the meeting-followup job (`services/jobs/meetingFollowup.ts`) the
 * moment a call settles, one per meeting (`ownsDedupKey` on the meeting's
 * owner and start), and on the never-auto list: the release is the person's.
 * A pending discovery card for the same call is closed in its favour, and a
 * discovery card is not filed beside it (`discovery-review.ts` `underway`),
 * so a call is one decision, not two.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

export const MEETING_FOLLOWUP_ACTION = 'meeting.draft_followup';

const meetingFollowupInput = z.object({
  /** The captured document (knowledge document id) the record is read from. */
  documentId: z.number().int().positive(),
  /** Its external id (`zoom:<uuid>`, `granola:<id>`), the discovery ledger's key for the same call. */
  externalId: z.string().default(''),
  /** What makes two captures one meeting (`meetingKey`). */
  meetingKey: z.string().min(1),
  title: z.string().default(''),
  start: z.string().default(''),
  owner: z.string().default(''),
  attendees: z.string().default(''),
  externalAttendees: z.string().default(''),
  counterpart: z.string().default(''),
  why: z.string().default(''),
  roomId: z.number().int().nonnegative().default(0),
  roomTitle: z.string().default(''),
  deckArtifactId: z.number().int().nonnegative().default(0),
  deckTitle: z.string().default(''),
  documentArtifactId: z.number().int().nonnegative().default(0),
  documentTitle: z.string().default(''),
  nextMeetingTitle: z.string().default(''),
  nextMeetingStart: z.string().default(''),
});

export type MeetingFollowupInput = z.infer<typeof meetingFollowupInput>;

/**
 * The meeting's name as a person reads it: the note-taker's title without the
 * time it appends.
 * @param input - The card's input.
 */
export function meetingName(input: Pick<MeetingFollowupInput, 'title'>): string {
  return input.title.replace(/\s+—\s+\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/, '').trim() || 'your call';
}

/**
 * The card. Pure, so it is tested without a database.
 * @param input - The card's input.
 */
export function meetingFollowupCard(input: MeetingFollowupInput): ReviewCard {
  const name = meetingName(input);
  const attach = input.deckArtifactId > 0 ? input.deckTitle || 'the deck' : input.documentArtifactId > 0 ? input.documentTitle || 'the document' : null;
  const to = input.externalAttendees || 'the people outside who were on it';
  const when = input.start ? input.start.slice(0, 10) : null;
  return {
    title: `Approve to draft the ${name} follow-up`,
    object: { title: name, subtitle: [when, input.counterpart ? `${input.counterpart} call` : null].filter(Boolean).join(' · ') || 'Meeting follow-up', section: 'Follow-ups' },
    system: 'Meetings',
    recommendation: { headline: 'A follow-up is owed', ...(input.why ? { detail: input.why } : {}) },
    summary: input.why || undefined,
    fields: [
      { label: 'Meeting', value: name },
      ...(when ? [{ label: 'When', value: when }] : []),
      { label: 'To', value: to },
      ...(input.roomId > 0 ? [{ label: 'Project', value: input.roomTitle || `#${input.roomId}`, href: `/dashboard/projects/${input.roomId}` }] : []),
      ...(attach ? [{ label: 'Attach', value: `${attach} (PDF)` }] : []),
      ...(input.nextMeetingTitle ? [{ label: 'Next on the calendar', value: `${input.nextMeetingTitle}${input.nextMeetingStart ? ` · ${input.nextMeetingStart.slice(0, 16).replace('T', ' ')}` : ''}` }] : []),
    ],
    nextAction: `Releases this call's record to the follow-up writer, who drafts the email to ${to}${attach ? ` with ${attach} attached as a PDF` : ''} into Review, and writes what changed back to the project. Nothing is sent.`,
    verbs: { approve: 'Draft the follow-up', reject: 'No follow-up' },
  };
}

/**
 * Whether this code runs inside a request, where `after` can hold work until
 * the response is sent.
 */
async function inRequestScope(): Promise<boolean> {
  try {
    const { after } = await import('next/server');
    after(() => {});
    return true;
  } catch {
    return false;
  }
}

export const meetingFollowupAction: Action<typeof meetingFollowupInput> = {
  id: MEETING_FOLLOWUP_ACTION,
  name: 'Draft a meeting follow-up',
  description: 'Release a client or prospect call\'s record to the follow-up writer and draft the follow-up email into Review. Filed by the meeting-followup job, one per meeting; never proposed by hand.',
  inputSchema: meetingFollowupInput,
  grant: 'review_proposal',
  external: true,
  // One item per meeting: a recording and a note of the same call refresh one card.
  ownsDedupKey: true,
  dedupKeyFor: input => `${MEETING_FOLLOWUP_ACTION}:${input.meetingKey}`,
  async reviewCard(_ctx, input) {
    return meetingFollowupCard(input);
  },
  async execute(ctx, input) {
    const { emitEvent } = await import('@/services/EventService');
    const { MEETING_FOLLOWUP_APPROVED } = await import('@/services/eventNames');
    // The draft runs after the approver's response when there is one to wait
    // for, and right here when there is not (an API or a script).
    const res = await emitEvent({
      orgId: ctx.orgId,
      type: MEETING_FOLLOWUP_APPROVED,
      payload: { ...input, approvalRunId: ctx.runId ?? 0, approvedBy: ctx.reviewedBy ?? '' },
      dedupeKey: `${MEETING_FOLLOWUP_APPROVED}:${ctx.runId ?? input.meetingKey}`,
      invokedBy: `action:${MEETING_FOLLOWUP_ACTION}`,
      dispatchMode: (await inRequestScope()) ? 'background' : 'inline',
    });
    return {
      released: true,
      documentId: input.documentId,
      handoff: MEETING_FOLLOWUP_APPROVED,
      fires: res.triggered.length,
      ...(res.triggered.length === 0 ? { note: 'nothing is subscribed to draft it (meeting.followup_approved) — turn on the meeting-followup plugin' } : {}),
    };
  },
};
